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

export interface NativePlayRequest {
  url: string
  title: string
  startSecs: number
  /** URL is an HLS playlist (transcode) rather than a progressive file. */
  hls: boolean
  httpHeaders: Record<string, string>
  /** 1-based ordinal among the container's audio tracks; unset = player default. */
  audioTrack?: number
  /** 0 = off; 1..embeddedSubtitleCount = embedded ordinal; above that = subtitleFiles[n - count - 1]. */
  subtitleTrack?: number
  embeddedSubtitleCount: number
  subtitleFiles: { url: string; mime: string; language: string; label: string }[]
  /** Diagnostics only: no audio track, so the video renderer runs on the standalone clock. */
  disableAudio?: boolean
}

export type NativeVideoEvent =
  | {
      type: 'state'
      playing: boolean
      buffering: boolean
      positionMs: number
      bufferedMs: number
      durationMs: number
      width: number
      height: number
      decoder: string
      dropped: number
      rendered: number
      skipped: number
      maxConsecutiveDropped: number
      /** Average early (+) / late (-) frame arrival vs. release time, ms. */
      frameOffsetMs: number
      displayHz: number
    }
  | { type: 'ended' }
  | { type: 'error'; message: string; fatal: boolean }

export type NativeControl =
  { action: 'play' | 'pause' } | { action: 'seek' | 'volume'; value: number }

/** In-app native video surface (ExoPlayer on Android) drawn underneath a transparent webview. */
export interface NativeVideoBackend {
  /** Starts playback and streams events until the returned function is called. */
  load(req: NativePlayRequest, onEvent: (e: NativeVideoEvent) => void): Promise<() => void>
  control(cmd: NativeControl): Promise<void>
  /** Releases the player and makes the webview opaque again. */
  stop(): Promise<void>
}

/** Native screen control (Android): real orientation lock and immersive playback. */
export interface ScreenControl {
  setOrientation(mode: 'landscape' | 'portrait' | 'auto'): Promise<void>
  setImmersive(enabled: boolean): Promise<void>
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
  nativeVideo: NativeVideoBackend | null
  /** Thermal/power/display/decoder facts for diagnostics (Android). */
  deviceInfo: (() => Promise<Record<string, unknown> | null>) | null
  /** Hand a URL to another installed player for an A/B check (Android). */
  openVideo: ((url: string, mime: string) => Promise<void>) | null
  /** Native share sheet for a generated text file (Android). null = not available. */
  shareFile:
    | ((file: { name: string; mime: string; content: string; subject: string }) => Promise<void>)
    | null
  screen: ScreenControl | null
  /** Human readable, sent as X-Plex-Device-Name */
  deviceName(): string
  platformName(): string
}
