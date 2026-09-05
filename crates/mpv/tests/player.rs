use std::{path::Path, sync::OnceLock, time::Duration};

use plaguex_mpv::{EndReason, MpvEvent, MpvPlayer, PlayRequest};
use tokio::sync::{mpsc, Mutex, MutexGuard};

const SAMPLE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/mock-plex/assets/sample.mp4"
);

fn request(start_secs: f64) -> PlayRequest {
    PlayRequest {
        url: SAMPLE.into(),
        title: "PlagueX mpv test".into(),
        start_secs,
        audio_track: None,
        subtitle_track: None,
        subtitle_files: Vec::new(),
        http_headers: Vec::new(),
        fullscreen: false,
    }
}

async fn env_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().await
}

async fn prepare() -> Option<MutexGuard<'static, ()>> {
    let lock = env_lock().await;
    if !MpvPlayer::is_available() {
        eprintln!("skipping mpv integration test: mpv is unavailable");
        return None;
    }
    assert!(Path::new(SAMPLE).is_file(), "sample video is missing");
    std::env::set_var("MPV_EXTRA_ARGS", "--vo=null --ao=null --no-config");
    Some(lock)
}

#[tokio::test]
async fn plays_to_eof() {
    let Some(_lock) = prepare().await else { return };
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let player = MpvPlayer::play(request(0.0), move |event| {
        let _ = sender.send(event);
    })
    .await
    .unwrap();

    let events = tokio::time::timeout(Duration::from_secs(20), async {
        let mut events = Vec::new();
        while let Some(event) = receiver.recv().await {
            let ended = matches!(event, MpvEvent::Ended { .. });
            events.push(event);
            if ended {
                return events;
            }
        }
        panic!("event channel closed before Ended");
    })
    .await
    .expect("playback did not end within 20 seconds");

    assert!(events
        .iter()
        .any(|event| matches!(event, MpvEvent::Started)));
    assert!(events.iter().any(|event| matches!(
        event,
        MpvEvent::Progress { time_secs, .. } if *time_secs > 0.0
    )));
    assert!(matches!(
        events.last(),
        Some(MpvEvent::Ended {
            reason: EndReason::Eof,
            ..
        })
    ));
    assert!(!player.is_running());
    std::env::remove_var("MPV_EXTRA_ARGS");
}

#[tokio::test]
async fn starts_at_offset_and_stops_as_quit() {
    let Some(_lock) = prepare().await else { return };
    let (sender, mut receiver) = mpsc::unbounded_channel();
    let player = MpvPlayer::play(request(5.0), move |event| {
        let _ = sender.send(event);
    })
    .await
    .unwrap();

    tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(event) = receiver.recv().await {
            if matches!(event, MpvEvent::Progress { time_secs, .. } if time_secs >= 5.0) {
                return;
            }
        }
        panic!("event channel closed before offset progress");
    })
    .await
    .expect("did not observe progress at the requested offset");

    player.stop().await.unwrap();
    let ended = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(MpvEvent::Ended { reason, .. }) = receiver.recv().await {
                return reason;
            }
        }
    })
    .await
    .expect("did not receive Ended after stop");
    assert_eq!(ended, EndReason::Quit);
    assert!(!player.is_running());
    std::env::remove_var("MPV_EXTRA_ARGS");
}
