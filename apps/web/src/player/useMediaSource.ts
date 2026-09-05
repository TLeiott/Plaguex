import { useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import type { PlaybackPlan } from '@plaguex/plex-api'
import { NativeVideo, buildNativeRequest, type MediaLike } from './nativeVideo'
import type { TrackChoice } from './plan'

export type SourceStatus =
  { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string; fatal: boolean }

/**
 * Attach a PlaybackPlan to a <video>. Progressive files go straight to `src`; HLS goes through
 * hls.js unless the browser plays HLS natively (Safari, WebKitGTK).
 */
export function useMediaSource(
  video: React.RefObject<MediaLike | null>,
  plan: PlaybackPlan | null,
  startSeconds: number,
  /** Needed by the native surface, which selects tracks itself instead of via the plan URL. */
  native?: { tracks: TrackChoice; title: string },
) {
  const [statusFor, setStatusFor] = useState<{ plan: PlaybackPlan | null; status: SourceStatus }>({
    plan,
    status: { kind: 'loading' },
  })
  // A new plan implicitly resets to 'loading' without an extra render from inside the effect.
  const status: SourceStatus = statusFor.plan === plan ? statusFor.status : { kind: 'loading' }
  const setStatus = (s: SourceStatus) => setStatusFor({ plan, status: s })
  const hlsRef = useRef<Hls | null>(null)

  useEffect(() => {
    const el = video.current
    if (!el || !plan) return
    let cancelled = false

    const onError = () => {
      const code = el.error?.code
      const message = el.error?.message || `media error ${code ?? '?'}`
      // MEDIA_ERR_SRC_NOT_SUPPORTED (4) / MEDIA_ERR_DECODE (3): the runtime lied about its capabilities.
      setStatus({ kind: 'error', message, fatal: code === 3 || code === 4 })
    }
    const onCanPlay = () => setStatus({ kind: 'ready' })
    el.addEventListener('error', onError)
    el.addEventListener('canplay', onCanPlay)

    if (el instanceof NativeVideo) {
      const req = buildNativeRequest({
        plan,
        tracks: native?.tracks ?? {},
        startSecs: startSeconds,
        title: native?.title ?? '',
      })
      el.load(req).catch((e: unknown) =>
        setStatus({
          kind: 'error',
          message: e instanceof Error ? e.message : String(e),
          fatal: true,
        }),
      )
      return () => {
        cancelled = true
        el.removeEventListener('error', onError)
        el.removeEventListener('canplay', onCanPlay)
        void el.unload()
      }
    }

    const seekToStart = () => {
      if (startSeconds > 0 && plan.protocol === 'file') el.currentTime = startSeconds
    }

    if (plan.protocol === 'file') {
      el.src = plan.url
      el.addEventListener('loadedmetadata', seekToStart, { once: true })
      void el.play().catch(() => undefined)
    } else {
      // Prefer hls.js wherever MediaSource exists: native HLS support is inconsistent
      // (Chromium answers "maybe" yet fails to demux; WebKitGTK depends on GStreamer plugins).
      void import('hls.js').then(({ default: HlsCtor }) => {
        if (cancelled) return
        if (!HlsCtor.isSupported()) {
          if (el.canPlayType('application/vnd.apple.mpegurl')) {
            el.src = plan.url
            void el.play().catch(() => undefined)
          } else {
            setStatus({
              kind: 'error',
              message: 'This browser supports neither HLS nor MediaSource',
              fatal: true,
            })
          }
          return
        }
        const token = new URL(plan.url).searchParams.get('X-Plex-Token')
        const hls = new HlsCtor({
          // Plex playlists reference segments without a token; append ours so requests authenticate.
          xhrSetup: (xhr, url) => {
            if (token && !url.includes('X-Plex-Token=')) {
              const u = new URL(url)
              u.searchParams.set('X-Plex-Token', token)
              xhr.open('GET', u.toString(), true)
            }
          },
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          backBufferLength: 30,
          enableWorker: true,
          lowLatencyMode: false,
          // Plex serves a live-ish playlist that grows as it transcodes; don't treat gaps as fatal.
          nudgeMaxRetry: 10,
          fragLoadingMaxRetry: 6,
          manifestLoadingMaxRetry: 4,
          levelLoadingMaxRetry: 6,
        })
        hls.on(HlsCtor.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
            else setStatus({ kind: 'error', message: `${data.type}: ${data.details}`, fatal: true })
          }
        })
        hls.on(HlsCtor.Events.MANIFEST_PARSED, () => void el.play().catch(() => undefined))
        hls.loadSource(plan.url)
        hls.attachMedia(el)
        hlsRef.current = hls
      })
    }

    return () => {
      cancelled = true
      el.removeEventListener('error', onError)
      el.removeEventListener('canplay', onCanPlay)
      hlsRef.current?.destroy()
      hlsRef.current = null
      el.removeAttribute('src')
      el.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setStatus is a stable wrapper around the state setter
  }, [video, plan, startSeconds, native?.tracks, native?.title])

  return status
}
