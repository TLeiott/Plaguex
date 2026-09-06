import type { DownloadProgress, ExternalPlayerEvent, NativeVideoEvent, Platform } from './types'
import { androidExternalPlayer } from './androidExternal'
import { createWebPlatform } from './web'

/**
 * Tauri implementation. Falls back to web behaviour where a native plugin is not wired yet,
 * so the app keeps working inside the webview while native pieces land.
 */
export async function createTauriPlatform(): Promise<Platform> {
  const web = createWebPlatform()
  const { invoke, convertFileSrc, Channel } = await import('@tauri-apps/api/core')
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
    screen:
      kind === 'tauri-android'
        ? {
            setOrientation: (mode) => invoke('plugin:plaguex-android|set_orientation', { mode }),
            setImmersive: (enabled) => invoke('plugin:plaguex-android|set_immersive', { enabled }),
          }
        : null,
    shareFile:
      kind === 'tauri-android' ? (file) => invoke('plugin:plaguex-android|share_file', file) : null,
    nativeVideo:
      kind === 'tauri-android'
        ? {
            load: async (req, onEvent) => {
              const channel = new Channel<NativeVideoEvent>()
              channel.onmessage = onEvent
              await invoke('plugin:plaguex-android|native_load', { req, onEvent: channel })
              return () => {
                channel.onmessage = () => undefined
              }
            },
            control: (cmd) =>
              invoke('plugin:plaguex-android|native_control', {
                action: cmd.action,
                value: 'value' in cmd ? cmd.value : null,
              }),
            stop: () => invoke('plugin:plaguex-android|native_stop'),
          }
        : null,
    deviceInfo:
      kind === 'tauri-android'
        ? () => invoke<Record<string, unknown> | null>('plugin:plaguex-android|device_info')
        : null,
    openVideo:
      kind === 'tauri-android'
        ? (url, mime) => invoke('plugin:plaguex-android|open_video', { url, mime })
        : null,
    externalPlayer:
      kind === 'tauri-android'
        ? androidExternalPlayer((args) => invoke('plugin:plaguex-android|external_play', args))
        : kind === 'tauri-linux'
          ? {
              available: () => invoke<boolean>('mpv_available'),
              play: (req, sessionId) => invoke('mpv_play', { req, sessionId }),
              stop: (sessionId) => invoke('mpv_stop', { sessionId: sessionId ?? null }),
              pause: (paused) => invoke('mpv_pause', { paused }),
              seek: (secs) => invoke('mpv_seek', { secs }),
              subscribe: (cb) => {
                let unlisten: (() => void) | null = null
                void import('@tauri-apps/api/event').then(({ listen }) =>
                  listen<{ sessionId: string; event: Omit<ExternalPlayerEvent, 'sessionId'> }>(
                    'mpv://event',
                    (e) =>
                      cb({
                        sessionId: e.payload.sessionId,
                        ...e.payload.event,
                      } as ExternalPlayerEvent),
                  ).then((u) => (unlisten = u)),
                )
                return () => unlisten?.()
              },
            }
          : null,
    downloads: {
      start: (req) => invoke('download_start', { req }),
      pause: (id) => invoke('download_pause', { id }),
      resume: (id) => invoke('download_resume', { id }),
      remove: (id) => invoke('download_remove', { id }),
      list: () => invoke('download_list'),
      playbackUrl: async (id) => {
        // Loopback server with proper Range support; asset:// is the fallback for older builds.
        const url = await invoke<string | null>('download_local_url', { id })
        if (url) return url
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
