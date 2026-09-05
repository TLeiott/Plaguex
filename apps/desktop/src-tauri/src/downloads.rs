//! Thin Tauri glue over `plaguex_downloader`. Progress is pushed to the webview as the
//! `download://progress` event; the payload matches `DownloadProgress` in the web app.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex},
    time::Instant,
};

use tauri_plugin_plaguex_android::DownloadState;

use plaguex_downloader::{DownloadManager, DownloadRequest, LocalFileServer, Progress, Status};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub struct Downloads(pub Arc<DownloadManager>);
/// Loopback HTTP server that streams finished downloads to the webview with Range support
/// (the asset protocol fails on Android when playback resumes mid-file).
pub struct Files(pub Arc<LocalFileServer>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub total_bytes: Option<u64>,
}

pub async fn init<R: Runtime>(app: &AppHandle<R>, dir: PathBuf) -> anyhow::Result<()> {
    let server = LocalFileServer::start().await?;
    let emitter = app.clone();
    let files = Arc::clone(&server);
    let tracker = Arc::new(StdMutex::new(Tracker::default()));
    let manager = DownloadManager::new(dir, move |p: Progress| {
        if p.status == Status::Done {
            if let Some(path) = &p.local_uri {
                files.register(&p.id, PathBuf::from(path));
            }
        }
        // Keep the Android foreground service (and its notification) in step with the queue.
        if let Some(state) = tracker.lock().unwrap().update(&p) {
            let _ = tauri_plugin_plaguex_android::set_download_state(&emitter, state);
        }
        let _ = emitter.emit("download://progress", &p);
    })
    .await?;
    manager.register_completed(&server).await;
    app.manage(Downloads(manager));
    app.manage(Files(server));
    Ok(())
}

fn err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

#[tauri::command]
pub async fn download_start(state: State<'_, Downloads>, req: StartRequest) -> Result<(), String> {
    state
        .0
        .start(DownloadRequest {
            id: req.id,
            url: req.url,
            file_name: req.file_name,
            total_bytes: req.total_bytes,
        })
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn download_pause(state: State<'_, Downloads>, id: String) -> Result<(), String> {
    state.0.pause(&id).await.map_err(err)
}

#[tauri::command]
pub async fn download_resume(state: State<'_, Downloads>, id: String) -> Result<(), String> {
    state.0.resume(&id).await.map_err(err)
}

#[tauri::command]
pub async fn download_remove(
    state: State<'_, Downloads>,
    files: State<'_, Files>,
    id: String,
) -> Result<(), String> {
    files.0.unregister(&id);
    state.0.remove(&id).await.map_err(err)
}

/// http://127.0.0.1:<port>/files/<id> for a finished download, or null.
#[tauri::command]
pub fn download_local_url(files: State<'_, Files>, id: String) -> Option<String> {
    files.0.url_for(&id)
}

#[tauri::command]
pub async fn download_list(state: State<'_, Downloads>) -> Result<Vec<Progress>, String> {
    Ok(state.0.list().await)
}

/// Absolute path of a finished download, or null. The frontend turns it into an asset:// URL.
#[tauri::command]
pub async fn download_local_path(
    state: State<'_, Downloads>,
    id: String,
) -> Result<Option<String>, String> {
    Ok(state
        .0
        .local_path(&id)
        .await
        .map(|p| p.to_string_lossy().into_owned()))
}

/// Aggregates per-download progress into one notification state. Emits at most every second, plus
/// immediately when the set of active downloads changes (so the service starts/stops promptly).
#[derive(Default)]
struct Tracker {
    items: HashMap<String, Progress>,
    last_emit: Option<Instant>,
    was_active: bool,
}

impl Tracker {
    fn update(&mut self, p: &Progress) -> Option<DownloadState> {
        self.items.insert(p.id.clone(), p.clone());
        let active: Vec<&Progress> = self
            .items
            .values()
            .filter(|x| matches!(x.status, Status::Queued | Status::Downloading))
            .collect();
        let is_active = !active.is_empty();
        let changed = is_active != self.was_active;
        let due = self.last_emit.map_or(true, |t| t.elapsed().as_secs() >= 1);
        if !changed && (!due || !is_active) {
            return None;
        }
        self.was_active = is_active;
        self.last_emit = Some(Instant::now());
        if !is_active {
            self.items
                .retain(|_, x| matches!(x.status, Status::Queued | Status::Downloading));
            return Some(DownloadState {
                active: false,
                title: String::new(),
                text: String::new(),
                progress: -1,
            });
        }
        let received: u64 = active.iter().map(|x| x.received_bytes).sum();
        let total: u64 = active.iter().filter_map(|x| x.total_bytes).sum();
        let progress = if total > 0 {
            ((received as f64 / total as f64) * 100.0).round() as i32
        } else {
            -1
        };
        let downloading = active
            .iter()
            .filter(|x| x.status == Status::Downloading)
            .count();
        let text = if total > 0 {
            format!(
                "{} of {} · {:.1} of {:.1} GB",
                downloading,
                active.len(),
                received as f64 / 1e9,
                total as f64 / 1e9
            )
        } else {
            format!("{} of {}", downloading, active.len())
        };
        Some(DownloadState {
            active: true,
            title: if active.len() == 1 {
                "Downloading 1 item".into()
            } else {
                format!("Downloading {} items", active.len())
            },
            text,
            progress,
        })
    }
}
