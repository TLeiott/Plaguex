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
  /** Human readable, sent as X-Plex-Device-Name */
  deviceName(): string
  platformName(): string
}
