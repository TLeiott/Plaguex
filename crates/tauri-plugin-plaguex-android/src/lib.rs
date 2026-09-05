//! Native Android helpers for Plaguex. On every other platform the commands are no-ops so the web
//! layer can call them unconditionally.

use serde::{Deserialize, Serialize};
use tauri::{
    ipc::Channel,
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
struct Native<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
struct OrientationArgs {
    mode: String,
}

#[derive(Serialize)]
struct EnabledArgs {
    enabled: bool,
}

#[derive(Serialize)]
struct ShareFileArgs {
    name: String,
    mime: String,
    content: String,
    subject: String,
}

/// Writes text to a cache file and opens the platform share sheet (Android only).
#[tauri::command]
async fn share_file<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    mime: String,
    content: String,
    subject: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        app.state::<Native<R>>()
            .0
            .run_mobile_plugin::<()>(
                "shareFile",
                ShareFileArgs {
                    name,
                    mime,
                    content,
                    subject,
                },
            )
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (
            app,
            ShareFileArgs {
                name,
                mime,
                content,
                subject,
            },
        );
        Err("sharing is only available on Android".into())
    }
}

/// Aggregate download state shown in the Android foreground-service notification.
#[derive(Serialize, Clone, Debug)]
pub struct DownloadState {
    pub active: bool,
    pub title: String,
    pub text: String,
    /// 0..=100, or -1 when unknown.
    pub progress: i32,
}

/// Start/update (active) or stop (inactive) the foreground service that keeps downloads running
/// while the app is in the background. No-op off Android or before the plugin is registered.
pub fn set_download_state<R: Runtime>(
    app: &AppHandle<R>,
    state: DownloadState,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        match app.try_state::<Native<R>>() {
            Some(native) => native
                .0
                .run_mobile_plugin::<()>("setDownloadState", state)
                .map_err(|e| e.to_string()),
            None => Ok(()),
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, state);
        Ok(())
    }
}

#[cfg(target_os = "android")]
fn call<R: Runtime>(
    app: &AppHandle<R>,
    method: &str,
    payload: impl Serialize,
) -> Result<(), String> {
    app.state::<Native<R>>()
        .0
        .run_mobile_plugin::<()>(method, payload)
        .map_err(|e| e.to_string())
}

/// `mode`: "landscape" | "portrait" | "auto".
#[tauri::command]
fn set_orientation<R: Runtime>(app: AppHandle<R>, mode: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return call(&app, "setOrientation", OrientationArgs { mode });
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, OrientationArgs { mode });
        Ok(())
    }
}

/// Hide (true) or show (false) the system bars, e.g. while a video plays.
#[tauri::command]
fn set_immersive<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return call(&app, "setImmersive", EnabledArgs { enabled });
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, EnabledArgs { enabled });
        Ok(())
    }
}

/// When true (default) the webview is padded so content never sits under the status/navigation
/// bars. False lets content draw edge-to-edge (used together with immersive playback).
#[tauri::command]
fn set_fit_system_windows<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return call(&app, "setFitSystemWindows", EnabledArgs { enabled });
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, EnabledArgs { enabled });
        Ok(())
    }
}

/// Playback request for the in-app native video surface (ExoPlayer). Mirrors the web
/// `NativePlayRequest`; passed through to Kotlin untouched.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NativePlayRequest {
    pub url: String,
    pub title: String,
    pub start_secs: f64,
    pub hls: bool,
    pub http_headers: std::collections::HashMap<String, String>,
    pub audio_track: Option<u32>,
    pub subtitle_track: Option<u32>,
    pub embedded_subtitle_count: u32,
    pub subtitle_files: Vec<SubtitleFile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleFile {
    pub url: String,
    pub mime: String,
    pub language: String,
    pub label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeLoadArgs {
    req: NativePlayRequest,
    on_event: Channel<serde_json::Value>,
}

#[derive(Serialize)]
struct NativeControlArgs {
    action: String,
    value: Option<f64>,
}

/// Starts the native player underneath the (now transparent) webview; events stream on `on_event`.
#[tauri::command]
fn native_load<R: Runtime>(
    app: AppHandle<R>,
    req: NativePlayRequest,
    on_event: Channel<serde_json::Value>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return call(&app, "nativeLoad", NativeLoadArgs { req, on_event });
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, NativeLoadArgs { req, on_event });
        Err("native video is only available on Android".into())
    }
}

/// `action`: "play" | "pause" | "seek" (value = seconds) | "volume" (value = 0..1).
#[tauri::command]
fn native_control<R: Runtime>(
    app: AppHandle<R>,
    action: String,
    value: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return call(&app, "nativeControl", NativeControlArgs { action, value });
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, NativeControlArgs { action, value });
        Ok(())
    }
}

/// Releases the native player and restores the opaque webview.
#[tauri::command]
fn native_stop<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return call(&app, "nativeStop", ());
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("plaguex-android")
        .invoke_handler(tauri::generate_handler![
            set_orientation,
            set_immersive,
            set_fit_system_windows,
            share_file,
            native_load,
            native_control,
            native_stop
        ])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    _api.register_android_plugin("dev.plaguex.android", "PlaguexPlugin")?;
                _app.manage(Native(handle));
            }
            Ok(())
        })
        .build()
}
