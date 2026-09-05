use std::{
    env,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{unix::OwnedWriteHalf, UnixStream},
    process::{Child, Command},
    sync::{Mutex, Notify},
    time::{sleep, timeout},
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECT_INTERVAL: Duration = Duration::from_millis(50);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(500);
const STOP_GRACE: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest {
    pub url: String,
    pub title: String,
    pub start_secs: f64,
    pub audio_track: Option<u32>,
    pub subtitle_track: Option<u32>,
    pub subtitle_files: Vec<String>,
    pub http_headers: Vec<String>,
    pub fullscreen: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum MpvEvent {
    Started,
    Progress {
        time_secs: f64,
        duration_secs: Option<f64>,
        paused: bool,
    },
    Ended {
        time_secs: f64,
        reason: EndReason,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EndReason {
    Eof,
    Quit,
    Error,
}

pub struct MpvPlayer {
    writer: Mutex<Option<OwnedWriteHalf>>,
    child: Mutex<Option<Child>>,
    request_id: AtomicU64,
    running: AtomicBool,
    finished: Notify,
    socket_path: PathBuf,
    on_event: Arc<dyn Fn(MpvEvent) + Send + Sync>,
}

impl MpvPlayer {
    pub fn is_available() -> bool {
        std::process::Command::new(mpv_binary())
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    pub async fn play(
        req: PlayRequest,
        on_event: impl Fn(MpvEvent) + Send + Sync + 'static,
    ) -> Result<Arc<Self>> {
        let socket_path = unique_socket_path();
        let mut child = Command::new(mpv_binary())
            .args(build_args(&req, &socket_path))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .context("failed to start mpv")?;

        let stream = match connect_to_socket(&socket_path, &mut child).await {
            Ok(stream) => stream,
            Err(error) => {
                let _ = child.kill().await;
                let _ = std::fs::remove_file(&socket_path);
                return Err(error);
            }
        };
        let (reader, writer) = stream.into_split();
        let player = Arc::new(Self {
            writer: Mutex::new(Some(writer)),
            child: Mutex::new(Some(child)),
            request_id: AtomicU64::new(1),
            running: AtomicBool::new(true),
            finished: Notify::new(),
            socket_path,
            on_event: Arc::new(on_event),
        });

        for (id, property) in ["time-pos", "pause", "duration", "eof-reached"]
            .into_iter()
            .enumerate()
        {
            player
                .send_command(json!(["observe_property", id + 1, property]))
                .await?;
        }

        let monitor = Arc::clone(&player);
        tokio::spawn(async move {
            monitor.monitor(reader).await;
        });
        Ok(player)
    }

    pub async fn stop(&self) -> Result<()> {
        if !self.is_running() {
            return Ok(());
        }

        let command_result = self.send_command(json!(["quit"])).await;
        if timeout(STOP_GRACE, self.wait_until_finished())
            .await
            .is_err()
            && self.is_running()
        {
            let mut child = self.child.lock().await;
            if let Some(child) = child.as_mut() {
                child.kill().await.context("failed to kill mpv")?;
            }
            drop(child);
            timeout(Duration::from_secs(1), self.wait_until_finished())
                .await
                .context("mpv monitor did not finish after process termination")?;
        }
        command_result
    }

    pub async fn pause(&self, paused: bool) -> Result<()> {
        self.send_command(json!(["set_property", "pause", paused]))
            .await
    }

    pub async fn seek(&self, secs: f64) -> Result<()> {
        self.send_command(json!(["seek", secs, "absolute"])).await
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }

    async fn wait_until_finished(&self) {
        while self.is_running() {
            tokio::select! {
                _ = self.finished.notified() => {}
                _ = sleep(Duration::from_millis(25)) => {}
            }
        }
    }

    async fn send_command(&self, command: Value) -> Result<()> {
        if !self.is_running() {
            anyhow::bail!("mpv is not running");
        }
        let request_id = self.request_id.fetch_add(1, Ordering::Relaxed);
        let message = json!({ "command": command, "request_id": request_id });
        let mut bytes = serde_json::to_vec(&message)?;
        bytes.push(b'\n');
        let mut writer = self.writer.lock().await;
        writer
            .as_mut()
            .context("mpv IPC connection is closed")?
            .write_all(&bytes)
            .await
            .context("failed to write mpv IPC command")
    }

    async fn monitor(self: Arc<Self>, reader: tokio::net::unix::OwnedReadHalf) {
        let mut lines = BufReader::new(reader).lines();
        let mut state = PlaybackState::default();
        let mut exit_status = None;
        let mut socket_closed = false;
        let mut poll = tokio::time::interval(Duration::from_millis(25));

        while exit_status.is_none() {
            tokio::select! {
                line = lines.next_line(), if !socket_closed => {
                    match line {
                        Ok(Some(line)) => self.handle_message(&line, &mut state),
                        Ok(None) => socket_closed = true,
                        Err(error) => {
                            tracing::warn!(%error, "failed to read mpv IPC message");
                            socket_closed = true;
                        }
                    }
                }
                _ = poll.tick() => {
                    let mut child = self.child.lock().await;
                    match child.as_mut().map(Child::try_wait) {
                        Some(Ok(status)) => exit_status = status,
                        Some(Err(error)) => {
                            tracing::warn!(%error, "failed to query mpv process");
                            state.saw_error = true;
                            break;
                        }
                        None => break,
                    }
                }
            }
        }

        // Nach dem Prozessende können noch abschließende IPC-Ereignisse gepuffert sein.
        while let Ok(Ok(Some(line))) = timeout(Duration::from_millis(100), lines.next_line()).await
        {
            self.handle_message(&line, &mut state);
        }

        let status = if let Some(status) = exit_status {
            Some(status)
        } else {
            let mut child = self.child.lock().await;
            match child.as_mut() {
                Some(child) => child.wait().await.ok(),
                None => None,
            }
        };
        self.child.lock().await.take();
        self.writer.lock().await.take();
        let reason = if state.eof || state.end_reason.as_deref() == Some("eof") {
            EndReason::Eof
        } else if state.saw_error
            || state.end_reason.as_deref() == Some("error")
            || status.is_some_and(|status| !status.success())
        {
            EndReason::Error
        } else {
            EndReason::Quit
        };
        self.finish(MpvEvent::Ended {
            time_secs: state.time_secs,
            reason,
        });
    }

    fn handle_message(&self, line: &str, state: &mut PlaybackState) {
        let message: Value = match serde_json::from_str(line) {
            Ok(message) => message,
            Err(error) => {
                tracing::warn!(%error, "ignored invalid mpv IPC message");
                return;
            }
        };
        if message.get("request_id").is_some()
            && message.get("error").and_then(Value::as_str) != Some("success")
        {
            tracing::warn!(response = %message, "mpv IPC command failed");
        }

        match message.get("event").and_then(Value::as_str) {
            Some("file-loaded") => self.emit_started(state),
            Some("end-file") => {
                state.end_reason = message
                    .get("reason")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            Some("property-change") => self.handle_property(&message, state),
            _ => {}
        }
    }

    fn handle_property(&self, message: &Value, state: &mut PlaybackState) {
        let name = message.get("name").and_then(Value::as_str);
        let data = message.get("data").unwrap_or(&Value::Null);
        let pause_changed = match name {
            Some("time-pos") => {
                if let Some(time) = data.as_f64() {
                    state.time_secs = time;
                }
                self.emit_started(state);
                false
            }
            Some("duration") => {
                state.duration_secs = data.as_f64();
                false
            }
            Some("pause") => {
                let old = state.paused;
                if let Some(paused) = data.as_bool() {
                    state.paused = paused;
                }
                old != state.paused
            }
            Some("eof-reached") => {
                if let Some(eof) = data.as_bool() {
                    state.eof = eof;
                }
                false
            }
            _ => false,
        };

        if state.started
            && (pause_changed
                || state
                    .last_progress
                    .is_none_or(|last| last.elapsed() >= PROGRESS_INTERVAL))
        {
            (self.on_event)(MpvEvent::Progress {
                time_secs: state.time_secs,
                duration_secs: state.duration_secs,
                paused: state.paused,
            });
            state.last_progress = Some(Instant::now());
        }
    }

    fn emit_started(&self, state: &mut PlaybackState) {
        if !state.started {
            state.started = true;
            (self.on_event)(MpvEvent::Started);
        }
    }

    fn finish(&self, event: MpvEvent) {
        if self.running.swap(false, Ordering::AcqRel) {
            let _ = std::fs::remove_file(&self.socket_path);
            (self.on_event)(event);
            self.finished.notify_waiters();
        }
    }
}

impl Drop for MpvPlayer {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

#[derive(Default)]
struct PlaybackState {
    time_secs: f64,
    duration_secs: Option<f64>,
    paused: bool,
    eof: bool,
    started: bool,
    saw_error: bool,
    end_reason: Option<String>,
    last_progress: Option<Instant>,
}

pub fn build_args(req: &PlayRequest, ipc_socket: &Path) -> Vec<String> {
    let mut args = vec![
        "--no-terminal".into(),
        "--force-window=yes".into(),
        "--keep-open=no".into(),
        "--idle=no".into(),
        "--ytdl=no".into(),
        format!("--input-ipc-server={}", ipc_socket.display()),
        format!("--title={}", req.title),
        format!("--osd-playing-msg={}", req.title),
    ];
    if req.start_secs > 0.0 {
        args.push(format!("--start={}", req.start_secs));
    }
    if let Some(track) = req.audio_track {
        args.push(format!("--aid={track}"));
    }
    if let Some(track) = req.subtitle_track {
        args.push(if track == 0 {
            "--sid=no".into()
        } else {
            format!("--sid={track}")
        });
    }
    args.extend(
        req.subtitle_files
            .iter()
            .map(|file| format!("--sub-file={file}")),
    );
    if !req.http_headers.is_empty() {
        args.push(format!(
            "--http-header-fields={}",
            req.http_headers.join(",")
        ));
    }
    if req.fullscreen {
        args.push("--fullscreen".into());
    }
    if let Ok(extra) = env::var("MPV_EXTRA_ARGS") {
        args.extend(extra.split_whitespace().map(str::to_owned));
    }
    args.push(req.url.clone());
    args
}

fn mpv_binary() -> String {
    env::var("MPV_BIN").unwrap_or_else(|_| "mpv".into())
}

fn unique_socket_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    env::temp_dir().join(format!("plaguex-mpv-{}-{nanos}.sock", std::process::id()))
}

async fn connect_to_socket(socket_path: &Path, child: &mut Child) -> Result<UnixStream> {
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    loop {
        match UnixStream::connect(socket_path).await {
            Ok(stream) => return Ok(stream),
            Err(error) if Instant::now() < deadline => {
                if let Some(status) = child.try_wait().context("failed to query mpv process")? {
                    anyhow::bail!("mpv exited before IPC was ready: {status}");
                }
                sleep(CONNECT_INTERVAL).await;
                let _ = error;
            }
            Err(error) => return Err(error).context("timed out connecting to mpv IPC socket"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn request() -> PlayRequest {
        PlayRequest {
            url: "https://example.com/video.mp4".into(),
            title: "A title".into(),
            start_secs: 12.5,
            audio_track: Some(2),
            subtitle_track: Some(3),
            subtitle_files: vec!["https://example.com/one.srt".into(), "two.srt".into()],
            http_headers: vec!["Authorization: token".into(), "X-Test: yes".into()],
            fullscreen: true,
        }
    }

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    #[test]
    fn builds_all_requested_arguments_with_url_last() {
        let _lock = env_lock();
        env::remove_var("MPV_EXTRA_ARGS");
        let args = build_args(&request(), Path::new("/tmp/player.sock"));

        for expected in [
            "--no-terminal",
            "--force-window=yes",
            "--keep-open=no",
            "--idle=no",
            "--ytdl=no",
            "--input-ipc-server=/tmp/player.sock",
            "--title=A title",
            "--osd-playing-msg=A title",
            "--start=12.5",
            "--aid=2",
            "--sid=3",
            "--sub-file=https://example.com/one.srt",
            "--sub-file=two.srt",
            "--http-header-fields=Authorization: token,X-Test: yes",
            "--fullscreen",
        ] {
            assert!(args.iter().any(|arg| arg == expected), "missing {expected}");
        }
        assert_eq!(args.last().unwrap(), "https://example.com/video.mp4");
    }

    #[test]
    fn maps_subtitle_track_zero_to_no_subtitles() {
        let _lock = env_lock();
        env::remove_var("MPV_EXTRA_ARGS");
        let mut req = request();
        req.subtitle_track = Some(0);
        let args = build_args(&req, Path::new("/tmp/player.sock"));

        assert!(args.iter().any(|arg| arg == "--sid=no"));
        assert!(!args.iter().any(|arg| arg == "--sid=0"));
    }

    #[test]
    fn omits_optional_arguments_when_not_requested() {
        let _lock = env_lock();
        env::remove_var("MPV_EXTRA_ARGS");
        let mut req = request();
        req.start_secs = 0.0;
        req.audio_track = None;
        req.subtitle_track = None;
        req.subtitle_files.clear();
        req.http_headers.clear();
        req.fullscreen = false;
        let args = build_args(&req, Path::new("/tmp/player.sock"));

        for prefix in [
            "--start=",
            "--aid=",
            "--sid=",
            "--sub-file=",
            "--http-header-fields=",
        ] {
            assert!(!args.iter().any(|arg| arg.starts_with(prefix)));
        }
        assert!(!args.iter().any(|arg| arg == "--fullscreen"));
    }

    #[test]
    fn inserts_whitespace_split_extra_arguments_before_url() {
        let _lock = env_lock();
        env::set_var("MPV_EXTRA_ARGS", "--vo=null  --ao=null --no-config");
        let args = build_args(&request(), Path::new("/tmp/player.sock"));
        env::remove_var("MPV_EXTRA_ARGS");

        assert_eq!(
            &args[args.len() - 4..],
            [
                "--vo=null",
                "--ao=null",
                "--no-config",
                "https://example.com/video.mp4"
            ]
        );
    }
}
