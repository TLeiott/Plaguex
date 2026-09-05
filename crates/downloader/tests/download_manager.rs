use std::{
    convert::Infallible,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{header, HeaderMap, Response, StatusCode},
    routing::get,
    Router,
};
use futures_util::stream;
use plaguex_downloader::{DownloadManager, DownloadRequest, Status};
use tokio::{net::TcpListener, time::sleep};

const DATA_LEN: usize = 1024 * 1024;

#[derive(Clone)]
struct ServerState {
    data: Arc<Vec<u8>>,
    supports_range: bool,
    throttle: bool,
    range_requests: Arc<AtomicUsize>,
    active: Arc<AtomicUsize>,
    max_active: Arc<AtomicUsize>,
}

struct ActiveGuard(ServerState);

impl Drop for ActiveGuard {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

struct TestServer {
    url: String,
    state: ServerState,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl TestServer {
    async fn start(supports_range: bool, throttle: bool) -> Self {
        let state = ServerState {
            data: Arc::new((0..DATA_LEN).map(|index| (index % 251) as u8).collect()),
            supports_range,
            throttle,
            range_requests: Arc::new(AtomicUsize::new(0)),
            active: Arc::new(AtomicUsize::new(0)),
            max_active: Arc::new(AtomicUsize::new(0)),
        };
        let app = Router::new()
            .route("/file", get(serve_file))
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self {
            url: format!("http://{address}/file"),
            state,
            task,
        }
    }
}

async fn serve_file(State(state): State<ServerState>, headers: HeaderMap) -> Response<Body> {
    let requested_start = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("bytes="))
        .and_then(|value| value.strip_suffix('-'))
        .and_then(|value| value.parse::<usize>().ok());
    if requested_start.is_some() {
        state.range_requests.fetch_add(1, Ordering::SeqCst);
    }
    let start = if state.supports_range {
        requested_start.unwrap_or(0)
    } else {
        0
    };
    if start >= state.data.len() {
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(
                header::CONTENT_RANGE,
                format!("bytes */{}", state.data.len()),
            )
            .body(Body::empty())
            .unwrap();
    }

    let active = state.active.fetch_add(1, Ordering::SeqCst) + 1;
    state.max_active.fetch_max(active, Ordering::SeqCst);
    let length = state.data.len() - start;
    let throttle = state.throttle;
    let body_state = (start, ActiveGuard(state.clone()));
    let body = Body::from_stream(stream::unfold(
        body_state,
        move |(position, guard)| async move {
            if position >= guard.0.data.len() {
                return None;
            }
            if throttle {
                sleep(Duration::from_millis(12)).await;
            }
            let end = (position + 16 * 1024).min(guard.0.data.len());
            let bytes = Bytes::copy_from_slice(&guard.0.data[position..end]);
            Some((Ok::<_, Infallible>(bytes), (end, guard)))
        },
    ));
    let mut response = Response::builder()
        .status(if state.supports_range && requested_start.is_some() {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header(header::CONTENT_LENGTH, length);
    if state.supports_range && requested_start.is_some() {
        response = response.header(
            header::CONTENT_RANGE,
            format!(
                "bytes {start}-{}/{}",
                state.data.len() - 1,
                state.data.len()
            ),
        );
    }
    response.body(body).unwrap()
}

struct TestDir(PathBuf);

impl TestDir {
    fn new(name: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("plaguex-{name}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn request(id: &str, url: &str, file_name: &str) -> DownloadRequest {
    DownloadRequest {
        id: id.into(),
        url: url.into(),
        file_name: file_name.into(),
        total_bytes: Some(DATA_LEN as u64),
    }
}

async fn wait_for(manager: &DownloadManager, id: &str, status: Status) {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if manager
                .list()
                .await
                .iter()
                .any(|progress| progress.id == id && progress.status == status)
            {
                return;
            }
            sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("download {id} did not reach {status:?}"));
}

#[tokio::test]
async fn downloads_complete_file_and_renames_it() {
    let server = TestServer::start(true, false).await;
    let dir = TestDir::new("full");
    let manager = DownloadManager::new(dir.path().into(), |_| {})
        .await
        .unwrap();

    manager
        .start(request("one", &server.url, "video.bin"))
        .await
        .unwrap();
    wait_for(&manager, "one", Status::Done).await;

    assert_eq!(
        tokio::fs::read(dir.path().join("video.bin")).await.unwrap(),
        *server.state.data
    );
    assert!(!dir.path().join("video.bin.part").exists());
    assert_eq!(
        manager.local_path("one").await.unwrap(),
        dir.path().join("video.bin")
    );
}

#[tokio::test]
async fn pause_then_resume_uses_range_and_preserves_integrity() {
    let server = TestServer::start(true, true).await;
    let dir = TestDir::new("resume");
    let manager = DownloadManager::new(dir.path().into(), |_| {})
        .await
        .unwrap();
    manager
        .start(request("one", &server.url, "video.bin"))
        .await
        .unwrap();
    wait_for(&manager, "one", Status::Downloading).await;
    sleep(Duration::from_millis(300)).await;
    manager.pause("one").await.unwrap();
    let partial_len = tokio::fs::metadata(dir.path().join("video.bin.part"))
        .await
        .unwrap()
        .len();
    assert!(partial_len > 0 && partial_len < DATA_LEN as u64);

    manager.resume("one").await.unwrap();
    wait_for(&manager, "one", Status::Done).await;

    assert!(server.state.range_requests.load(Ordering::SeqCst) >= 1);
    assert_eq!(
        tokio::fs::read(dir.path().join("video.bin")).await.unwrap(),
        *server.state.data
    );
}

#[tokio::test]
async fn server_without_range_support_restarts_from_zero() {
    let server = TestServer::start(false, false).await;
    let dir = TestDir::new("no-range");
    let stale = vec![255; 128 * 1024];
    tokio::fs::write(dir.path().join("video.bin.part"), stale)
        .await
        .unwrap();
    let manager = DownloadManager::new(dir.path().into(), |_| {})
        .await
        .unwrap();

    manager
        .start(request("one", &server.url, "video.bin"))
        .await
        .unwrap();
    wait_for(&manager, "one", Status::Done).await;

    assert_eq!(server.state.range_requests.load(Ordering::SeqCst), 1);
    assert_eq!(
        tokio::fs::read(dir.path().join("video.bin")).await.unwrap(),
        *server.state.data
    );
}

#[tokio::test]
async fn remove_cancels_and_deletes_download_files() {
    let server = TestServer::start(true, true).await;
    let dir = TestDir::new("remove");
    let manager = DownloadManager::new(dir.path().into(), |_| {})
        .await
        .unwrap();
    manager
        .start(request("one", &server.url, "video.bin"))
        .await
        .unwrap();
    wait_for(&manager, "one", Status::Downloading).await;
    sleep(Duration::from_millis(100)).await;

    manager.remove("one").await.unwrap();
    sleep(Duration::from_millis(50)).await;

    assert!(manager.list().await.is_empty());
    assert!(!dir.path().join("video.bin").exists());
    assert!(!dir.path().join("video.bin.part").exists());
}

#[tokio::test]
async fn manifest_reloads_in_flight_entries_as_paused() {
    let server = TestServer::start(true, true).await;
    let dir = TestDir::new("persist");
    let manager = DownloadManager::new(dir.path().into(), |_| {})
        .await
        .unwrap();
    manager
        .start(request("one", &server.url, "video.bin"))
        .await
        .unwrap();
    wait_for(&manager, "one", Status::Downloading).await;

    let reloaded = DownloadManager::new(dir.path().into(), |_| {})
        .await
        .unwrap();
    let progress = reloaded.list().await;
    assert_eq!(progress.len(), 1);
    assert_eq!(progress[0].status, Status::Paused);
    manager.pause("one").await.unwrap();
}

#[tokio::test]
async fn limits_concurrency_to_two_and_starts_queued_download() {
    let server = TestServer::start(true, true).await;
    let dir = TestDir::new("queue");
    let manager = DownloadManager::new(dir.path().into(), |_| {})
        .await
        .unwrap();
    for index in 1..=3 {
        manager
            .start(request(
                &index.to_string(),
                &server.url,
                &format!("video-{index}.bin"),
            ))
            .await
            .unwrap();
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let items = manager.list().await;
            let downloading = items
                .iter()
                .filter(|item| item.status == Status::Downloading)
                .count();
            let queued = items
                .iter()
                .filter(|item| item.status == Status::Queued)
                .count();
            if downloading == 2 && queued == 1 {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("two downloads never ran concurrently");

    for index in 1..=3 {
        wait_for(&manager, &index.to_string(), Status::Done).await;
    }
    assert_eq!(server.state.max_active.load(Ordering::SeqCst), 2);
}
