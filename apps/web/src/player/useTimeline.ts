import { useEffect, useRef } from 'react'
import type { Item, PlaybackState } from '@plaguex/plex-api'
import { activeServer } from '@/plex/api'

/**
 * Keeps the server informed about playback. Plex expects a timeline ping roughly every 10 s while
 * playing plus one on every state change; the server derives viewOffset / watched state from it.
 */
export function useTimeline(
  item: Item,
  sessionId: string,
  video: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  /** HLS streams start at the requested offset with currentTime 0; add it back for absolute positions. */
  offsetMs = 0,
) {
  const last = useRef<{ state: PlaybackState; timeMs: number }>({ state: 'stopped', timeMs: 0 })

  useEffect(() => {
    if (!enabled) return
    const el = video.current
    if (!el) return
    const durationMs = item.durationMs ?? (Math.floor(el.duration * 1000) || 0)

    // Track the position ourselves: by the time this effect's cleanup runs on unmount, the media
    // source hook may already have reset the element (currentTime would read 0).
    let lastTimeMs = Math.floor(el.currentTime * 1000)
    const onTimeUpdate = () => {
      lastTimeMs = Math.floor(el.currentTime * 1000)
    }
    el.addEventListener('timeupdate', onTimeUpdate)
    const report = (state: PlaybackState, keepalive = false) => {
      const timeMs = offsetMs + lastTimeMs
      last.current = { state, timeMs }
      void activeServer()
        .timeline({
          ratingKey: item.ratingKey,
          key: item.key,
          state,
          timeMs,
          durationMs: durationMs || Math.floor(el.duration * 1000),
          playSessionId: sessionId,
          keepalive,
        })
        .catch(() => undefined)
    }
    // Tab closed / full navigation: React never unmounts, so send the final position with keepalive.
    const onPageHide = () => report('stopped', true)
    window.addEventListener('pagehide', onPageHide)

    const onPlay = () => report('playing')
    const onPause = () => report('paused')
    const onEnded = () => report('stopped')
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    // The 'play' event may already have fired before this effect attached; report the current state now.
    if (!el.paused && !el.ended) report('playing')
    const interval = setInterval(() => {
      if (!el.paused && !el.ended) report('playing')
    }, 10_000)

    return () => {
      clearInterval(interval)
      window.removeEventListener('pagehide', onPageHide)
      el.removeEventListener('timeupdate', onTimeUpdate)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
      // Final position so resume works even when the tab is closed mid-episode.
      report('stopped')
    }
  }, [item, sessionId, video, enabled, offsetMs])
}
