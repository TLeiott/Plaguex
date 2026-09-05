//! Tauri shell for Plaguex. The web app does everything Plex-related; this layer only adds what a
//! browser cannot do: resumable downloads to disk and serving them back for offline playback.

mod downloads;
mod mpv;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_plaguex_android::init())
        .manage(mpv::Mpv::default())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("app data dir")
                .join("downloads");
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move { downloads::init(&handle, dir).await })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            downloads::download_start,
            downloads::download_pause,
            downloads::download_resume,
            downloads::download_remove,
            downloads::download_list,
            downloads::download_local_path,
            downloads::download_local_url,
            mpv::mpv_available,
            mpv::mpv_play,
            mpv::mpv_stop,
            mpv::mpv_pause,
            mpv::mpv_seek,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
