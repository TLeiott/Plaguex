use std::{
    collections::HashMap,
    future::IntoFuture,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use axum::{
    body::Body,
    extract::{Path as AxumPath, State},
    http::{header, HeaderValue, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex},
    task::JoinHandle,
};
use tower_http::services::ServeFile;

struct Shutdown {
    sender: oneshot::Sender<()>,
    task: JoinHandle<std::io::Result<()>>,
}

pub struct LocalFileServer {
    port: u16,
    files: RwLock<HashMap<String, PathBuf>>,
    shutdown: Mutex<Option<Shutdown>>,
}

impl LocalFileServer {
    /// Binds 127.0.0.1 on an ephemeral port and serves files registered through `register`.
    pub async fn start() -> anyhow::Result<Arc<Self>> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        let port = listener.local_addr()?.port();
        let server = Arc::new(Self {
            port,
            files: RwLock::new(HashMap::new()),
            shutdown: Mutex::new(None),
        });
        let router = Router::new()
            .route("/files/{id}", get(serve_file).head(serve_file))
            .with_state(Arc::clone(&server));
        let (sender, receiver) = oneshot::channel();
        let task = tokio::spawn(
            axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = receiver.await;
                })
                .into_future(),
        );
        *server.shutdown.lock().await = Some(Shutdown { sender, task });
        Ok(server)
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// Makes `path` reachable as GET /files/<id>; replaces any previous registration for the id.
    pub fn register(&self, id: &str, path: PathBuf) {
        if valid_id(id) {
            self.files
                .write()
                .expect("file registration lock poisoned")
                .insert(id.to_owned(), path);
        }
    }

    pub fn unregister(&self, id: &str) {
        self.files
            .write()
            .expect("file registration lock poisoned")
            .remove(id);
    }

    pub fn url_for(&self, id: &str) -> Option<String> {
        self.files
            .read()
            .expect("file registration lock poisoned")
            .contains_key(id)
            .then(|| format!("http://127.0.0.1:{}/files/{id}", self.port))
    }

    pub async fn shutdown(&self) {
        let Some(shutdown) = self.shutdown.lock().await.take() else {
            return;
        };
        let _ = shutdown.sender.send(());
        let _ = shutdown.task.await;
    }
}

async fn serve_file(
    State(server): State<Arc<LocalFileServer>>,
    AxumPath(id): AxumPath<String>,
    request: Request<Body>,
) -> Response {
    if !valid_id(&id) {
        return with_cors(StatusCode::BAD_REQUEST.into_response());
    }
    let path = server
        .files
        .read()
        .expect("file registration lock poisoned")
        .get(&id)
        .cloned();
    let Some(path) = path else {
        return with_cors(StatusCode::NOT_FOUND.into_response());
    };
    let content_type = content_type(&path);
    let mut service = ServeFile::new(path);
    let response = match service.try_call(request).await {
        Ok(response) => response.map(Body::new),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    with_headers(response, content_type)
}

fn with_headers(mut response: Response, content_type: &'static str) -> Response {
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    with_cors(response)
}

fn with_cors(mut response: Response) -> Response {
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && !id.contains('/') && !id.contains("..")
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mkv") => "video/x-matroska",
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("avi") => "video/x-msvideo",
        Some("mov") => "video/quicktime",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use reqwest::{header, StatusCode};

    use super::LocalFileServer;

    #[tokio::test]
    async fn serves_registered_files_and_ranges() {
        let directory = std::env::temp_dir().join(format!(
            "plaguex-downloader-server-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("video.mkv");
        let bytes = (0..=255).cycle().take(512).collect::<Vec<u8>>();
        fs::write(&path, &bytes).unwrap();

        let server = LocalFileServer::start().await.unwrap();
        server.register("123", path);
        let url = server.url_for("123").unwrap();
        let client = reqwest::Client::new();

        let full = client.get(&url).send().await.unwrap();
        assert_eq!(full.status(), StatusCode::OK);
        assert_eq!(full.headers()[header::ACCEPT_RANGES], "bytes");
        assert_eq!(full.headers()[header::CONTENT_TYPE], "video/x-matroska");
        assert_eq!(full.bytes().await.unwrap().as_ref(), bytes);

        let partial = client
            .get(&url)
            .header(header::RANGE, "bytes=100-199")
            .send()
            .await
            .unwrap();
        assert_eq!(partial.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            partial.headers()[header::CONTENT_RANGE],
            "bytes 100-199/512"
        );
        assert_eq!(partial.bytes().await.unwrap().as_ref(), &bytes[100..200]);

        let head = client.head(&url).send().await.unwrap();
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(head.headers()[header::CONTENT_LENGTH], "512");

        let unknown = client
            .get(format!("http://127.0.0.1:{}/files/unknown", server.port()))
            .send()
            .await
            .unwrap();
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);

        server.register("../x", directory.join("secret"));
        assert!(server.url_for("../x").is_none());
        let invalid = client
            .get(format!("http://127.0.0.1:{}/files/..%2Fx", server.port()))
            .send()
            .await
            .unwrap();
        assert!(matches!(
            invalid.status(),
            StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND
        ));

        server.shutdown().await;
        fs::remove_dir_all(directory).unwrap();
    }
}
