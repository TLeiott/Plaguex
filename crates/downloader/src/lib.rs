use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use futures_util::StreamExt;
use reqwest::{header, StatusCode};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{
    fs,
    io::AsyncWriteExt,
    sync::{Mutex, Semaphore},
};
use tokio_util::sync::CancellationToken;

mod serve;

pub use serve::LocalFileServer;

#[derive(Clone, Debug)]
pub struct DownloadRequest {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub total_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Queued,
    Downloading,
    Paused,
    Done,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub received_bytes: u64,
    pub total_bytes: Option<u64>,
    pub status: Status,
    pub error: Option<String>,
    pub local_uri: Option<String>,
}

#[derive(Debug, Error)]
enum DownloadError {
    #[error("invalid file name")]
    InvalidFileName,
    #[error("server rejected resume at byte {0}")]
    InvalidRange(u64),
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestEntry {
    id: String,
    url: String,
    file_name: String,
    total_bytes: Option<u64>,
    status: Status,
    received_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

struct Entry {
    manifest: ManifestEntry,
    cancel: Option<CancellationToken>,
    completion: Option<CancellationToken>,
    generation: u64,
}

pub struct DownloadManager {
    root_dir: PathBuf,
    client: reqwest::Client,
    entries: Mutex<HashMap<String, Entry>>,
    persist_lock: Mutex<()>,
    semaphore: Arc<Semaphore>,
    on_progress: Arc<dyn Fn(Progress) + Send + Sync>,
}

enum TransferResult {
    Done { received: u64, total: Option<u64> },
    Cancelled { received: u64, total: Option<u64> },
}

struct CompletionGuard(CancellationToken);

impl Drop for CompletionGuard {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

impl DownloadManager {
    pub async fn new(
        root_dir: PathBuf,
        on_progress: impl Fn(Progress) + Send + Sync + 'static,
    ) -> Result<Arc<Self>> {
        fs::create_dir_all(&root_dir).await?;
        let root_dir = fs::canonicalize(root_dir).await?;
        let manifest_path = root_dir.join("manifest.json");
        let loaded: Vec<ManifestEntry> = match fs::read(&manifest_path).await {
            Ok(bytes) => serde_json::from_slice(&bytes).context("invalid download manifest")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };

        let mut entries = HashMap::new();
        for mut manifest in loaded {
            validate_file_name(&manifest.file_name)?;
            if matches!(manifest.status, Status::Queued | Status::Downloading) {
                manifest.status = Status::Paused;
            }
            let final_path = root_dir.join(&manifest.file_name);
            let part_path = part_path(&root_dir, &manifest.file_name);
            if manifest.status == Status::Done && !final_path.is_file() {
                manifest.status = Status::Error;
                manifest.error = Some("file missing".into());
                manifest.received_bytes = 0;
            } else if manifest.status != Status::Done {
                manifest.received_bytes = file_len(&part_path).await.unwrap_or(0);
            }
            entries.insert(
                manifest.id.clone(),
                Entry {
                    manifest,
                    cancel: None,
                    completion: None,
                    generation: 0,
                },
            );
        }

        let manager = Arc::new(Self {
            root_dir,
            client: reqwest::Client::new(),
            entries: Mutex::new(entries),
            persist_lock: Mutex::new(()),
            semaphore: Arc::new(Semaphore::new(2)),
            on_progress: Arc::new(on_progress),
        });
        manager.persist().await?;
        Ok(manager)
    }

    pub async fn start(self: &Arc<Self>, req: DownloadRequest) -> Result<()> {
        validate_file_name(&req.file_name)?;
        if req.id.is_empty() {
            anyhow::bail!("download id must not be empty");
        }

        let previous_completion = {
            let entries = self.entries.lock().await;
            if let Some(entry) = entries.get(&req.id) {
                if matches!(
                    entry.manifest.status,
                    Status::Queued | Status::Downloading | Status::Done
                ) {
                    return Ok(());
                }
                entry.completion.clone()
            } else {
                None
            }
        };
        if let Some(completion) = previous_completion {
            completion.cancelled().await;
        }

        let final_path = self.root_dir.join(&req.file_name);
        let existing_final_len = file_len(&final_path).await;
        let (progress, generation, cancel, completion) = {
            let mut entries = self.entries.lock().await;
            if let Some(entry) = entries.get(&req.id) {
                if matches!(
                    entry.manifest.status,
                    Status::Queued | Status::Downloading | Status::Done
                ) {
                    return Ok(());
                }
            }

            let entry = entries.entry(req.id.clone()).or_insert_with(|| Entry {
                manifest: ManifestEntry {
                    id: req.id.clone(),
                    url: req.url.clone(),
                    file_name: req.file_name.clone(),
                    total_bytes: req.total_bytes,
                    status: Status::Queued,
                    received_bytes: 0,
                    error: None,
                },
                cancel: None,
                completion: None,
                generation: 0,
            });
            entry.manifest.url = req.url;
            entry.manifest.file_name = req.file_name;
            entry.manifest.total_bytes = req.total_bytes.or(entry.manifest.total_bytes);
            entry.manifest.error = None;
            if let Some(len) = existing_final_len {
                entry.manifest.status = Status::Done;
                entry.manifest.received_bytes = len;
                entry.manifest.total_bytes = Some(len);
            } else {
                entry.manifest.status = Status::Queued;
                entry.manifest.received_bytes = 0;
            }
            entry.generation += 1;
            let cancel = CancellationToken::new();
            let completion = CancellationToken::new();
            entry.cancel = Some(cancel.clone());
            entry.completion = Some(completion.clone());
            if entry.manifest.status == Status::Done {
                cancel.cancel();
                completion.cancel();
                entry.cancel = None;
                entry.completion = None;
            }
            (
                self.progress_for(&entry.manifest),
                entry.generation,
                cancel,
                completion,
            )
        };
        self.persist().await?;
        self.emit(progress.clone());
        if progress.status != Status::Done {
            self.spawn_worker(req.id, generation, cancel, completion);
        }
        Ok(())
    }

    pub async fn pause(&self, id: &str) -> Result<()> {
        let (progress, completion) = {
            let mut entries = self.entries.lock().await;
            let entry = entries.get_mut(id).context("download not found")?;
            if matches!(entry.manifest.status, Status::Done | Status::Paused) {
                return Ok(());
            }
            if let Some(cancel) = entry.cancel.take() {
                cancel.cancel();
            }
            let completion = entry.completion.take();
            entry.generation += 1;
            entry.manifest.status = Status::Paused;
            entry.manifest.error = None;
            (self.progress_for(&entry.manifest), completion)
        };
        self.persist().await?;
        self.emit(progress);
        if let Some(completion) = completion {
            completion.cancelled().await;
        }
        Ok(())
    }

    pub async fn resume(self: &Arc<Self>, id: &str) -> Result<()> {
        let req = {
            let entries = self.entries.lock().await;
            let entry = entries.get(id).context("download not found")?;
            if matches!(
                entry.manifest.status,
                Status::Queued | Status::Downloading | Status::Done
            ) {
                return Ok(());
            }
            DownloadRequest {
                id: entry.manifest.id.clone(),
                url: entry.manifest.url.clone(),
                file_name: entry.manifest.file_name.clone(),
                total_bytes: entry.manifest.total_bytes,
            }
        };
        self.start(req).await
    }

    pub async fn remove(&self, id: &str) -> Result<()> {
        let removed = {
            let mut entries = self.entries.lock().await;
            entries.remove(id)
        };
        if let Some(mut entry) = removed {
            if let Some(cancel) = entry.cancel.take() {
                cancel.cancel();
            }
            if let Some(completion) = entry.completion.take() {
                completion.cancelled().await;
            }
            remove_if_exists(&self.root_dir.join(&entry.manifest.file_name)).await?;
            remove_if_exists(&part_path(&self.root_dir, &entry.manifest.file_name)).await?;
            self.persist().await?;
        }
        Ok(())
    }

    pub async fn list(&self) -> Vec<Progress> {
        let entries = self.entries.lock().await;
        let mut values: Vec<_> = entries
            .values()
            .map(|entry| self.progress_for(&entry.manifest))
            .collect();
        values.sort_by(|a, b| a.id.cmp(&b.id));
        values
    }

    pub async fn local_path(&self, id: &str) -> Option<PathBuf> {
        let entries = self.entries.lock().await;
        let entry = entries.get(id)?;
        (entry.manifest.status == Status::Done)
            .then(|| self.root_dir.join(&entry.manifest.file_name))
    }

    pub async fn register_completed(&self, server: &LocalFileServer) {
        let completed = {
            let entries = self.entries.lock().await;
            entries
                .values()
                .filter(|entry| entry.manifest.status == Status::Done)
                .map(|entry| {
                    (
                        entry.manifest.id.clone(),
                        self.root_dir.join(&entry.manifest.file_name),
                    )
                })
                .collect::<Vec<_>>()
        };
        for (id, path) in completed {
            server.register(&id, path);
        }
    }

    fn spawn_worker(
        self: &Arc<Self>,
        id: String,
        generation: u64,
        cancel: CancellationToken,
        completion: CancellationToken,
    ) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let _completion = CompletionGuard(completion);
            let permit = tokio::select! {
                permit = manager.semaphore.clone().acquire_owned() => match permit {
                    Ok(permit) => permit,
                    Err(_) => return,
                },
                _ = cancel.cancelled() => return,
            };
            if !manager
                .set_status(&id, generation, Status::Downloading, None)
                .await
            {
                return;
            }
            let result = manager.transfer(&id, generation, &cancel).await;
            drop(permit);
            match result {
                Ok(TransferResult::Done { received, total }) => {
                    manager
                        .finish(&id, generation, Status::Done, received, total, None)
                        .await;
                }
                Ok(TransferResult::Cancelled { received, total }) => {
                    manager
                        .finish(&id, generation, Status::Paused, received, total, None)
                        .await;
                }
                Err(error) => {
                    tracing::warn!(download_id = %id, %error, "download failed");
                    let received = manager.part_len(&id).await.unwrap_or(0);
                    manager
                        .finish(
                            &id,
                            generation,
                            Status::Error,
                            received,
                            None,
                            Some(error.to_string()),
                        )
                        .await;
                }
            }
        });
    }

    async fn transfer(
        &self,
        id: &str,
        generation: u64,
        cancel: &CancellationToken,
    ) -> Result<TransferResult> {
        let (url, file_name, fallback_total) = {
            let entries = self.entries.lock().await;
            let entry = entries.get(id).context("download removed")?;
            (
                entry.manifest.url.clone(),
                entry.manifest.file_name.clone(),
                entry.manifest.total_bytes,
            )
        };
        let part = part_path(&self.root_dir, &file_name);
        let final_path = self.root_dir.join(&file_name);
        let mut offset = file_len(&part).await.unwrap_or(0);
        let mut request = self.client.get(&url);
        if offset > 0 {
            request = request.header(header::RANGE, format!("bytes={offset}-"));
        }
        let response = tokio::select! {
            response = request.send() => response?,
            _ = cancel.cancelled() => return Ok(TransferResult::Cancelled { received: offset, total: fallback_total }),
        };

        if response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
            let total = content_range_total(response.headers()).or(fallback_total);
            if total == Some(offset) {
                fs::rename(&part, &final_path).await?;
                return Ok(TransferResult::Done {
                    received: offset,
                    total,
                });
            }
            return Err(DownloadError::InvalidRange(offset).into());
        }
        let status = response.status();
        if status != StatusCode::OK && status != StatusCode::PARTIAL_CONTENT {
            return Err(response.error_for_status().unwrap_err().into());
        }
        let append = status == StatusCode::PARTIAL_CONTENT && offset > 0;
        if !append {
            offset = 0;
        }
        let total = content_range_total(response.headers())
            .or_else(|| response.content_length().map(|length| length + offset))
            .or(fallback_total);
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&part)
            .await?;
        let mut received = offset;
        let mut stream = response.bytes_stream();
        let mut last_report = Instant::now();
        loop {
            let chunk = tokio::select! {
                chunk = stream.next() => chunk,
                _ = cancel.cancelled() => {
                    file.flush().await?;
                    return Ok(TransferResult::Cancelled { received, total });
                }
            };
            let Some(chunk) = chunk else { break };
            let chunk = chunk?;
            file.write_all(&chunk).await?;
            received += chunk.len() as u64;
            if last_report.elapsed() >= Duration::from_millis(250) {
                self.update_received(id, generation, received, total).await;
                last_report = Instant::now();
            }
        }
        file.flush().await?;
        drop(file);
        if cancel.is_cancelled() {
            return Ok(TransferResult::Cancelled { received, total });
        }
        fs::rename(&part, &final_path).await?;
        Ok(TransferResult::Done { received, total })
    }

    async fn set_status(
        &self,
        id: &str,
        generation: u64,
        status: Status,
        error: Option<String>,
    ) -> bool {
        let progress = {
            let mut entries = self.entries.lock().await;
            let Some(entry) = entries.get_mut(id) else {
                return false;
            };
            if entry.generation != generation {
                return false;
            }
            entry.manifest.status = status;
            entry.manifest.error = error;
            self.progress_for(&entry.manifest)
        };
        let _ = self.persist().await;
        self.emit(progress);
        true
    }

    async fn update_received(&self, id: &str, generation: u64, received: u64, total: Option<u64>) {
        let progress = {
            let mut entries = self.entries.lock().await;
            let Some(entry) = entries.get_mut(id) else {
                return;
            };
            if entry.generation != generation {
                return;
            }
            entry.manifest.received_bytes = received;
            entry.manifest.total_bytes = total;
            self.progress_for(&entry.manifest)
        };
        let _ = self.persist().await;
        self.emit(progress);
    }

    async fn finish(
        &self,
        id: &str,
        generation: u64,
        status: Status,
        received: u64,
        total: Option<u64>,
        error: Option<String>,
    ) {
        let progress = {
            let mut entries = self.entries.lock().await;
            let Some(entry) = entries.get_mut(id) else {
                return;
            };
            if entry.generation != generation {
                return;
            }
            entry.cancel = None;
            entry.manifest.status = status;
            entry.manifest.received_bytes = received;
            entry.manifest.total_bytes = total.or(entry.manifest.total_bytes);
            entry.manifest.error = error;
            self.progress_for(&entry.manifest)
        };
        let _ = self.persist().await;
        self.emit(progress);
    }

    async fn part_len(&self, id: &str) -> Option<u64> {
        let file_name = self
            .entries
            .lock()
            .await
            .get(id)
            .map(|entry| entry.manifest.file_name.clone())?;
        file_len(&part_path(&self.root_dir, &file_name)).await
    }

    fn progress_for(&self, entry: &ManifestEntry) -> Progress {
        Progress {
            id: entry.id.clone(),
            received_bytes: entry.received_bytes,
            total_bytes: entry.total_bytes,
            status: entry.status.clone(),
            error: entry.error.clone(),
            local_uri: (entry.status == Status::Done).then(|| {
                self.root_dir
                    .join(&entry.file_name)
                    .to_string_lossy()
                    .into_owned()
            }),
        }
    }

    fn emit(&self, progress: Progress) {
        (self.on_progress)(progress);
    }

    async fn persist(&self) -> Result<()> {
        let _guard = self.persist_lock.lock().await;
        let mut manifest: Vec<_> = self
            .entries
            .lock()
            .await
            .values()
            .map(|entry| entry.manifest.clone())
            .collect();
        manifest.sort_by(|a, b| a.id.cmp(&b.id));
        let bytes = serde_json::to_vec_pretty(&manifest)?;
        let temporary = self.root_dir.join("manifest.json.tmp");
        fs::write(&temporary, bytes).await?;
        fs::rename(temporary, self.root_dir.join("manifest.json")).await?;
        Ok(())
    }
}

fn validate_file_name(file_name: &str) -> Result<()> {
    let path = Path::new(file_name);
    let mut components = path.components();
    if file_name.is_empty()
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
    {
        return Err(DownloadError::InvalidFileName.into());
    }
    Ok(())
}

fn part_path(root: &Path, file_name: &str) -> PathBuf {
    root.join(format!("{file_name}.part"))
}

fn content_range_total(headers: &header::HeaderMap) -> Option<u64> {
    headers
        .get(header::CONTENT_RANGE)?
        .to_str()
        .ok()?
        .rsplit_once('/')?
        .1
        .parse()
        .ok()
}

async fn file_len(path: &Path) -> Option<u64> {
    fs::metadata(path).await.ok().map(|metadata| metadata.len())
}

async fn remove_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}
