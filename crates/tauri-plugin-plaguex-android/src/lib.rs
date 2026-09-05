//! Native Android helpers for Plaguex. On every other platform the commands are no-ops so the web
//! layer can call them unconditionally.

use serde::Serialize;
use tauri::{
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

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("plaguex-android")
        .invoke_handler(tauri::generate_handler![
            set_orientation,
            set_immersive,
            set_fit_system_windows
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
