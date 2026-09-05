import type { DownloadProgress, Platform } from './types'
import { createWebPlatform } from './web'

/**
 * Tauri implementation. Falls back to web behaviour where a native plugin is not wired yet,
 * so the app keeps working inside the webview while native pieces land.
 */
export async function createTauriPlatform(): Promise<Platform> {
  const web = createWebPlatform()
  const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
  const { platform: osPlatform } = await import('@tauri-apps/plugin-os')
  const os = osPlatform()
  const kind = os === 'android' ? 'tauri-android' : os === 'linux' ? 'tauri-linux' : 'tauri-other'
  return {
    ...web,
    kind,
    openExternal: async (url) => {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
    },
    deviceName: () => (kind === 'tauri-android' ? 'Plaguex Android' : 'Plaguex Desktop'),
    platformName: () => (kind === 'tauri-android' ? 'Android' : 'Chrome'),
    downloads: {
      start: (req) => invoke('download_start', { req }),
      pause: (id) => invoke('download_pause', { id }),
      resume: (id) => invoke('download_resume', { id }),
      remove: (id) => invoke('download_remove', { id }),
      list: () => invoke('download_list'),
      playbackUrl: async (id) => {
        const path = await invoke<string | null>('download_local_path', { id })
        return path ? convertFileSrc(path) : null
      },
      subscribe: (cb) => {
        let unlisten: (() => void) | null = null
        void import('@tauri-apps/api/event').then(({ listen }) =>
          listen<DownloadProgress>('download://progress', (e) => cb(e.payload)).then(
            (u) => (unlisten = u),
          ),
        )
        return () => unlisten?.()
      },
    },
  }
}
