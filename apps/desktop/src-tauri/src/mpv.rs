//! Thin Tauri glue over `plaguex_mpv`: launches an external mpv window for playback on Linux and
//! forwards its events to the webview as `mpv://event`, tagged with the caller's session id so the
//! UI can ignore events from a previous (already replaced) session.

use std::{
    collections::HashSet,
    sync::{Arc, Mutex as StdMutex},
};

use plaguex_mpv::{MpvEvent, MpvPlayer, PlayRequest};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::Mutex;

pub struct Current {
    session_id: String,
    player: Arc<MpvPlayer>,
}

#[derive(Default)]
pub struct Mpv {
    pub current: Mutex<Option<Current>>,
    /// Sessions stopped by us (replacement or explicit stop). Their final `Ended` event is not
    /// forwarded: the UI already knows, and a stale event must not be mistaken for the live session.
    pub cancelled: Arc<StdMutex<HashSet<String>>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaggedEvent<'a> {
    session_id: &'a str,
    // Nested on purpose: serde's `flatten` drops the fields of an internally tagged enum.
    event: MpvEvent,
}

fn err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

#[tauri::command]
pub fn mpv_available() -> bool {
    MpvPlayer::is_available()
}

#[tauri::command]
pub async fn mpv_play<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Mpv>,
    req: PlayRequest,
    session_id: String,
) -> Result<(), String> {
    // Hold the lock for the whole spawn so two rapid play() calls cannot race each other.
    let mut slot = state.current.lock().await;
    if let Some(existing) = slot.as_ref() {
        if existing.session_id == session_id && existing.player.is_running() {
            // Same session asked twice (React StrictMode re-runs effects in dev): keep the player.
            return Ok(());
        }
    }
    if let Some(existing) = slot.take() {
        state
            .cancelled
            .lock()
            .unwrap()
            .insert(existing.session_id.clone());
        let _ = existing.player.stop().await;
    }
    let emitter = app.clone();
    let sid = session_id.clone();
    let cancelled = Arc::clone(&state.cancelled);
    let player = MpvPlayer::play(req, move |event: MpvEvent| {
        if matches!(event, MpvEvent::Ended { .. }) && cancelled.lock().unwrap().remove(&sid) {
            return;
        }
        let _ = emitter.emit(
            "mpv://event",
            TaggedEvent {
                session_id: &sid,
                event,
            },
        );
    })
    .await
    .map_err(err)?;
    *slot = Some(Current { session_id, player });
    Ok(())
}

/// Stops playback. With a session id, only that session is stopped (a stale caller cannot kill a
/// newer session); without one, whatever is playing.
#[tauri::command]
pub async fn mpv_stop(state: State<'_, Mpv>, session_id: Option<String>) -> Result<(), String> {
    let mut slot = state.current.lock().await;
    let matches = match (&*slot, &session_id) {
        (Some(cur), Some(sid)) => cur.session_id == *sid,
        (Some(_), None) => true,
        (None, _) => false,
    };
    if matches {
        if let Some(cur) = slot.take() {
            state
                .cancelled
                .lock()
                .unwrap()
                .insert(cur.session_id.clone());
            cur.player.stop().await.map_err(err)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mpv_pause(state: State<'_, Mpv>, paused: bool) -> Result<(), String> {
    match state.current.lock().await.as_ref() {
        Some(cur) => cur.player.pause(paused).await.map_err(err),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn mpv_seek(state: State<'_, Mpv>, secs: f64) -> Result<(), String> {
    match state.current.lock().await.as_ref() {
        Some(cur) => cur.player.seek(secs).await.map_err(err),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use plaguex_mpv::EndReason;

    #[test]
    fn tagged_event_keeps_variant_fields_and_session_id() {
        let json = serde_json::to_value(TaggedEvent {
            session_id: "abc",
            event: MpvEvent::Ended {
                time_secs: 12.5,
                reason: EndReason::Eof,
            },
        })
        .unwrap();
        assert_eq!(json["sessionId"], "abc");
        assert_eq!(json["event"]["type"], "ended");
        assert_eq!(json["event"]["timeSecs"], 12.5);
        assert_eq!(json["event"]["reason"], "eof");
        let progress = serde_json::to_value(TaggedEvent {
            session_id: "abc",
            event: MpvEvent::Progress {
                time_secs: 3.0,
                duration_secs: None,
                paused: false,
            },
        })
        .unwrap();
        assert_eq!(progress["event"]["timeSecs"], 3.0);
        assert_eq!(progress["event"]["paused"], false);
    }
}
