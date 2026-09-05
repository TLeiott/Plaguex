import type { Platform } from './types'
import { createWebPlatform } from './web'

export type {
  Platform,
  DownloadManager,
  DownloadProgress,
  PlatformKind,
  ExternalPlayer,
  ExternalPlayRequest,
  ExternalPlayerEvent,
  ScreenControl,
  NativeVideoBackend,
  NativeVideoEvent,
  NativePlayRequest,
  NativeControl,
} from './types'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

let instance: Platform | null = null

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Resolve the platform once. Tauri builds swap in the native implementation lazily. */
export async function getPlatform(): Promise<Platform> {
  if (instance) return instance
  if (isTauri()) {
    const mod = await import('./tauri')
    instance = await mod.createTauriPlatform()
  } else {
    instance = createWebPlatform()
  }
  return instance
}

/** Synchronous access after getPlatform() resolved once (used by stores). */
export function platform(): Platform {
  if (!instance) throw new Error('platform not initialised; await getPlatform() first')
  return instance
}

export function setPlatformForTests(p: Platform) {
  instance = p
}
