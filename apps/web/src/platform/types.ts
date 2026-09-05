import type { PlayerCapabilities } from '@plaguex/plex-api'

export type PlatformKind = 'web' | 'tauri-linux' | 'tauri-android' | 'tauri-other'

export interface DownloadProgress {
  id: string
  receivedBytes: number
  totalBytes: number | null
  status: 'queued' | 'downloading' | 'paused' | 'done' | 'error'
  error?: string
  /** Local path or blob URL that can be played back offline. */
  localUri?: string
}

export interface DownloadManager {
  start(req: { id: string; url: string; fileName: string; totalBytes?: number }): Promise<void>
  pause(id: string): Promise<void>
  resume(id: string): Promise<void>
  remove(id: string): Promise<void>
  list(): Promise<DownloadProgress[]>
  subscribe(cb: (p: DownloadProgress) => void): () => void
  /** URL the <video> element can play for a completed download. */
  playbackUrl(id: string): Promise<string | null>
}

export interface ExternalPlayRequest {
  url: string
  title: string
  startSecs: number
  audioTrack?: number
  /** 0 = subtitles off */
  subtitleTrack?: number
  subtitleFiles: string[]
  httpHeaders: string[]
  fullscreen: boolean
}

export type ExternalPlayerEvent = { sessionId: string } & (
  | { type: 'started' }
  | { type: 'progress'; timeSecs: number; durationSecs: number | null; paused: boolean }
  | { type: 'ended'; timeSecs: number; reason: 'eof' | 'quit' | 'error' }
)

/** Native player process (mpv on Linux) driven from the UI. Sessions are tagged so a stale
 * session's events or stop() cannot affect a newer one. */
export interface ExternalPlayer {
  available(): Promise<boolean>
  play(req: ExternalPlayRequest, sessionId: string): Promise<void>
  stop(sessionId?: string): Promise<void>
  pause(paused: boolean): Promise<void>
  seek(secs: number): Promise<void>
  subscribe(cb: (e: ExternalPlayerEvent) => void): () => void
}

export interface Platform {
  kind: PlatformKind
  /** Persistent key/value storage for settings and session. */
  storage: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    remove(key: string): Promise<void>
  }
  openExternal(url: string): Promise<void>
  /** Probe what the runtime <video> element can decode. */
  probeCapabilities(): Promise<PlayerCapabilities>
  downloads: DownloadManager | null
  externalPlayer: ExternalPlayer | null
  /** Human readable, sent as X-Plex-Device-Name */
  deviceName(): string
  platformName(): string
}
