import type { ExternalPlayer, ExternalPlayerEvent, ExternalPlayRequest } from './types'

/** What the Android plugin resolves with once the other app returns. */
export interface ExternalPlayResult {
  resultCode: number
  /** -1 when the player did not report where it stopped. */
  positionMs: number
  durationMs: number
  completed: boolean
}

/** Result codes above Android's RESULT_OK/RESULT_CANCELED; VLC uses them for playback errors. */
const FIRST_ERROR_CODE = 2

/**
 * Hands a title to another installed app (VLC, MX Player, ...) via ACTION_VIEW. The ExternalPlayer
 * contract was written for mpv, which streams progress; another app only reports back when it
 * closes, so this adapter emits `started` at launch and one `ended` with the final position.
 */
export function androidExternalPlayer(
  invoke: (args: {
    url: string
    mime: string
    title: string
    positionMs: number
    subtitleUrl: string | null
  }) => Promise<ExternalPlayResult>,
): ExternalPlayer {
  const listeners = new Set<(e: ExternalPlayerEvent) => void>()
  const emit = (e: ExternalPlayerEvent) => listeners.forEach((cb) => cb(e))
  return {
    available: () => Promise.resolve(true),
    play: async (req: ExternalPlayRequest, sessionId: string) => {
      emit({ sessionId, type: 'started' })
      const r = await invoke({
        url: req.url,
        mime: 'video/*',
        title: req.title,
        positionMs: Math.round(req.startSecs * 1000),
        subtitleUrl: req.subtitleFiles[0] ?? null,
      })
      const nearEnd = r.durationMs > 0 && r.positionMs >= r.durationMs * 0.95
      emit({
        sessionId,
        type: 'ended',
        timeSecs: r.positionMs >= 0 ? r.positionMs / 1000 : NaN,
        reason:
          r.resultCode >= FIRST_ERROR_CODE ? 'error' : r.completed || nearEnd ? 'eof' : 'quit',
      })
    },
    // The other app owns playback; nothing to control from here.
    stop: () => Promise.resolve(),
    pause: () => Promise.resolve(),
    seek: () => Promise.resolve(),
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}
