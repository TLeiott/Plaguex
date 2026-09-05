//! Thin Tauri glue over `plaguex_downloader`. Progress is pushed to the webview as the
//! `download://progress` event; the payload matches `DownloadProgress` in the web app.

use std::{path::PathBuf, sync::Arc};

use plaguex_downloader::{DownloadManager, DownloadRequest, Progress};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

pub struct Downloads(pub Arc<DownloadManager>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub total_bytes: Option<u64>,
}

pub async fn init<R: Runtime>(app: &AppHandle<R>, dir: PathBuf) -> anyhow::Result<()> {
    let emitter = app.clone();
    let manager = DownloadManager::new(dir, move |p: Progress| {
        let _ = emitter.emit("download://progress", &p);
    })
    .await?;
    app.manage(Downloads(manager));
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
pub async fn download_remove(state: State<'_, Downloads>, id: String) -> Result<(), String> {
    state.0.remove(&id).await.map_err(err)
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
