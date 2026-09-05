import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Captions,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCw,
  SkipForward,
  Volume2,
  VolumeX,
  Settings2,
  AlertTriangle,
} from 'lucide-react'
import type { Item, MediaStream, PlaybackPlan, PlayerCapabilities } from '@plaguex/plex-api'
import { activeServer } from '@/plex/api'
import { q } from '@/plex/queries'
import { useSession } from '@/plex/session'
import { buildPlan, defaultTracks, newSessionId, type TrackChoice } from './plan'
import { useMediaSource } from './useMediaSource'
import { useTimeline } from './useTimeline'
import { Button, Spinner } from '@/components/ui'
import { cx, episodeCode, formatClock } from '@/lib/format'

interface Props {
  item: Item
  caps: PlayerCapabilities
  startMs: number
  /** Next episode, if any, for autoplay + the "Next" button. */
  next: Item | null
  /** Local file (asset://) for offline playback; bypasses the server-side plan. */
  localUrl?: string
}

const SEEK_STEP = 10

export function Player({ item, caps, startMs, next, localUrl }: Props) {
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const settings = useSession((s) => s.settings)
  const video = useRef<HTMLVideoElement>(null)
  const root = useRef<HTMLDivElement>(null)

  const mediaIndex = 0
  const [tracks, setTracks] = useState<TrackChoice>(() => defaultTracks(item, mediaIndex))
  const [sessionId] = useState(newSessionId)
  const [forceTranscode, setForceTranscode] = useState(false)
  const [resumeMs, setResumeMs] = useState(startMs)

  const plan: PlaybackPlan | null = useMemo(() => {
    try {
      if (localUrl) {
        const media = item.media[mediaIndex]
        const part = media?.parts[0]
        if (!media || !part) return null
        return {
          method: 'directplay',
          protocol: 'file',
          url: localUrl,
          mediaIndex,
          partIndex: 0,
          media,
          part,
          sessionId,
          reasons: [],
        }
      }
      return buildPlan({
        item,
        caps,
        tracks,
        startMs: resumeMs,
        sessionId,
        forceTranscode,
        mediaIndex,
      })
    } catch {
      return null
    }
  }, [item, caps, tracks, resumeMs, sessionId, forceTranscode, localUrl])

  const status = useMediaSource(video, plan, resumeMs / 1000)
  useTimeline(
    item,
    sessionId,
    video,
    status.kind === 'ready',
    plan?.protocol === 'hls' ? resumeMs : 0,
  )

  // Automatic recovery: direct play failed at runtime -> switch to the transcoder at the same position.
  useEffect(() => {
    if (
      status.kind === 'error' &&
      status.fatal &&
      plan?.method === 'directplay' &&
      !forceTranscode
    ) {
      setResumeMs(Math.floor((video.current?.currentTime ?? 0) * 1000) || resumeMs)
      setForceTranscode(true)
    }
  }, [status, plan, forceTranscode, resumeMs])

  // Stop the transcoder session when leaving.
  useEffect(() => {
    return () => {
      if (plan?.protocol === 'hls') void activeServer().stopTranscodeSession(sessionId)
    }
  }, [plan?.protocol, sessionId])

  // ---- playback state mirrored into React (cheap: only what the UI shows) ----
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(startMs / 1000)
  const [duration, setDuration] = useState((item.durationMs ?? 0) / 1000)
  const [buffering, setBuffering] = useState(true)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  // Phones: the webview already fills the screen, so offer rotation instead of fullscreen.
  const [touchDevice] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )
  const [rotated, setRotated] = useState(false)
  const toggleRotate = useCallback(async () => {
    if (rotated) {
      unlockOrientation()
      setRotated(false)
      return
    }
    // Prefer a real orientation lock; the CSS fallback kicks in when the webview refuses it.
    await lockLandscape()
    setRotated(true)
  }, [rotated])
  useEffect(() => () => unlockOrientation(), [])
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    const el = video.current
    if (!el) return
    const onTime = () => setTime(el.currentTime)
    const onDur = () => Number.isFinite(el.duration) && el.duration > 0 && setDuration(el.duration)
    const onPlay = () => (setPlaying(true), setEnded(false))
    const onPause = () => setPlaying(false)
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => setBuffering(false)
    const onVol = () => (setVolume(el.volume), setMuted(el.muted))
    const onEnded = () => setEnded(true)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('durationchange', onDur)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('playing', onPlaying)
    el.addEventListener('canplay', onPlaying)
    el.addEventListener('volumechange', onVol)
    el.addEventListener('ended', onEnded)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('durationchange', onDur)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('waiting', onWaiting)
      el.removeEventListener('playing', onPlaying)
      el.removeEventListener('canplay', onPlaying)
      el.removeEventListener('volumechange', onVol)
      el.removeEventListener('ended', onEnded)
    }
  }, [])

  useEffect(() => {
    const onFs = () => {
      const fs = Boolean(document.fullscreenElement)
      setFullscreen(fs)
      if (!fs) unlockOrientation()
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // HLS streams report time relative to the transcode offset; add it back for display.
  const hlsOffset = plan?.protocol === 'hls' ? resumeMs / 1000 : 0
  const absTime = time + hlsOffset
  const totalDuration = (item.durationMs ?? 0) / 1000 || duration

  // ---- actions ----
  const togglePlay = useCallback(() => {
    const el = video.current
    if (!el) return
    if (el.paused) void el.play()
    else el.pause()
  }, [])

  const seekTo = useCallback(
    (absSeconds: number) => {
      const el = video.current
      if (!el) return
      const target = Math.max(0, Math.min(totalDuration || Infinity, absSeconds))
      if (plan?.protocol === 'hls') {
        // Plex HLS with fastSeek: restarting at a new offset is more reliable than seeking inside the playlist.
        setResumeMs(Math.floor(target * 1000))
      } else {
        el.currentTime = target
      }
    },
    [plan?.protocol, totalDuration],
  )
  const seekBy = useCallback((delta: number) => seekTo(absTime + delta), [seekTo, absTime])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    void root.current
      ?.requestFullscreen()
      .then(() => lockLandscape())
      .catch(() => undefined)
  }, [])

  const goBack = useCallback(() => {
    // Stay inside the SPA: a cross-document history.back() would skip React cleanup (final progress ping).
    if (canGoBack) router.history.back()
    else
      void navigate({
        to: '/item/$ratingKey',
        params: { ratingKey: item.ratingKey },
        replace: true,
      })
  }, [canGoBack, router, navigate, item.ratingKey])

  const playNext = useCallback(() => {
    if (next)
      void navigate({
        to: '/play/$ratingKey',
        params: { ratingKey: next.ratingKey },
        replace: true,
      })
  }, [next, navigate])

  // ---- markers (intro / credits) ----
  const activeMarker = item.markers.find(
    (m) => absTime * 1000 >= m.startMs && absTime * 1000 < m.endMs - 500,
  )
  useEffect(() => {
    if (!activeMarker) return
    if (
      (activeMarker.type === 'intro' && settings.autoSkipIntro) ||
      (activeMarker.type === 'credits' && settings.autoSkipCredits)
    ) {
      if (activeMarker.type === 'credits' && activeMarker.final && next && settings.autoPlayNext)
        playNext()
      else seekTo(activeMarker.endMs / 1000)
    }
  }, [activeMarker, settings, seekTo, next, playNext])

  useEffect(() => {
    if (ended && next && settings.autoPlayNext) playNext()
  }, [ended, next, settings.autoPlayNext, playNext])

  // ---- controls visibility ----
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [menu, setMenu] = useState<'none' | 'tracks'>('none')
  const poke = useCallback(() => {
    setControlsVisible(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (menu === 'none') setControlsVisible(false)
    }, 3000)
  }, [menu])
  useEffect(() => {
    poke()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [poke])
  const showControls = controlsVisible || !playing || menu !== 'none' || buffering

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)
      )
        return
      const el = video.current
      if (!el) return
      let handled = true
      switch (e.key) {
        case ' ':
        case 'k':
          togglePlay()
          break
        case 'ArrowLeft':
        case 'j':
          seekBy(-SEEK_STEP)
          break
        case 'ArrowRight':
        case 'l':
          seekBy(SEEK_STEP)
          break
        case 'ArrowUp':
          el.volume = Math.min(1, el.volume + 0.1)
          break
        case 'ArrowDown':
          el.volume = Math.max(0, el.volume - 0.1)
          break
        case 'm':
          el.muted = !el.muted
          break
        case 'f':
          toggleFullscreen()
          break
        case 's':
          if (activeMarker) seekTo(activeMarker.endMs / 1000)
          break
        case 'n':
          playNext()
          break
        case 'c':
          setTracks((t) => ({
            ...t,
            subtitleStreamId: t.subtitleStreamId ? 0 : (defaultSubtitle(item, mediaIndex)?.id ?? 0),
          }))
          break
        case 'Escape':
          if (menu !== 'none') setMenu('none')
          else if (document.fullscreenElement) void document.exitFullscreen()
          else goBack()
          break
        default:
          handled = false
      }
      if (handled) {
        e.preventDefault()
        poke()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    togglePlay,
    seekBy,
    seekTo,
    toggleFullscreen,
    goBack,
    playNext,
    activeMarker,
    menu,
    poke,
    item,
  ])

  const changeTracks = (patch: TrackChoice) => {
    const el = video.current
    const at = Math.floor(((el?.currentTime ?? 0) + hlsOffset) * 1000)
    setResumeMs(at)
    setTracks((t) => ({ ...t, ...patch }))
    const part = item.media[mediaIndex]?.parts[0]
    if (part)
      void activeServer()
        .selectStreams(part.id, {
          ...(patch.audioStreamId !== undefined ? { audioStreamId: patch.audioStreamId } : {}),
          ...(patch.subtitleStreamId !== undefined
            ? { subtitleStreamId: patch.subtitleStreamId }
            : {}),
        })
        .catch(() => undefined)
  }

  const part = item.media[mediaIndex]?.parts[0]
  const audioStreams = part?.streams.filter((s) => s.kind === 'audio') ?? []
  const subtitleStreams = part?.streams.filter((s) => s.kind === 'subtitle') ?? []
  const title = item.type === 'episode' ? (item.grandparentTitle ?? item.title) : item.title
  const subtitle =
    item.type === 'episode'
      ? `${episodeCode(item.parentIndex, item.index)} · ${item.title}`
      : item.year
        ? String(item.year)
        : ''
  const remaining = totalDuration > 0 ? totalDuration - absTime : 0

  return (
    <div
      ref={root}
      className={cx(
        'relative h-full w-full select-none bg-black text-white',
        showControls ? 'cursor-default' : 'cursor-none',
        rotated && !nativeLandscape() && 'plaguex-rotated',
      )}
      data-rotated={rotated || undefined}
      onMouseMove={poke}
      onClick={(e) => {
        if (e.target === video.current) {
          togglePlay()
          poke()
        }
      }}
      onDoubleClick={(e) => e.target === video.current && toggleFullscreen()}
      data-testid="player"
      data-method={plan?.method}
    >
      <video
        ref={video}
        className="h-full w-full"
        playsInline
        crossOrigin="anonymous"
        preload="auto"
        data-testid="video"
      >
        {plan?.sidecarSubtitle ? (
          <track
            key={plan.sidecarSubtitle.stream.id}
            kind="subtitles"
            src={plan.sidecarSubtitle.url}
            default
            label={plan.sidecarSubtitle.stream.displayTitle}
          />
        ) : null}
      </video>

      {!playing && !buffering && !ended && status.kind === 'ready' ? (
        <button
          onClick={togglePlay}
          className="absolute left-1/2 top-1/2 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-2xl transition-transform hover:scale-105"
          aria-label="Play"
          data-testid="big-play"
        >
          <Play className="size-9 fill-current" />
        </button>
      ) : null}

      {buffering && status.kind !== 'error' ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner className="size-12 text-white" />
        </div>
      ) : null}

      {status.kind === 'error' &&
      (!status.fatal || forceTranscode || plan?.method !== 'directplay') ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center"
        >
          <AlertTriangle className="size-10 text-danger" />
          <p className="font-semibold">Playback failed</p>
          <p className="max-w-md text-sm text-fg-2">{status.message}</p>
          <div className="flex gap-2">
            {!forceTranscode ? (
              <Button onClick={() => setForceTranscode(true)}>Try transcoding</Button>
            ) : null}
            <Button variant="ghost" onClick={goBack}>
              Back
            </Button>
          </div>
        </div>
      ) : null}

      {/* Skip intro / credits */}
      {activeMarker && !(activeMarker.type === 'intro' && settings.autoSkipIntro) ? (
        <button
          onClick={() =>
            activeMarker.type === 'credits' && activeMarker.final && next
              ? playNext()
              : seekTo(activeMarker.endMs / 1000)
          }
          className="absolute bottom-28 right-6 rounded-lg bg-white/90 px-4 py-2 text-sm font-semibold text-black shadow-lg hover:bg-white"
          data-testid="skip-marker"
        >
          {activeMarker.type === 'credits' && next
            ? 'Next episode'
            : activeMarker.type === 'intro'
              ? 'Skip intro'
              : 'Skip'}
        </button>
      ) : null}

      {/* Top bar */}
      <div
        className={cx(
          'absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent p-4 transition-opacity duration-300',
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <Button
          size="icon"
          variant="ghost"
          className="text-white hover:bg-white/10 hover:text-white"
          onClick={goBack}
          aria-label="Back"
        >
          <ArrowLeft className="size-6" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{title}</p>
          {subtitle ? <p className="truncate text-sm text-white/70">{subtitle}</p> : null}
        </div>
        {plan ? (
          <span
            className={cx(
              'rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
              plan.method === 'directplay'
                ? 'bg-accent/20 text-accent'
                : plan.method === 'directstream'
                  ? 'bg-warn/20 text-warn'
                  : 'bg-danger/20 text-danger',
            )}
            title={plan.reasons.join('\n')}
            data-testid="play-method"
          >
            {localUrl
              ? 'Downloaded file'
              : plan.method === 'directplay'
                ? 'Direct play'
                : plan.method === 'directstream'
                  ? 'Direct stream'
                  : 'Transcode'}
            {plan.media.height ? ` · ${plan.media.height}p` : ''}
            {plan.media.bitrate ? ` · ${(plan.media.bitrate / 1000).toFixed(1)} Mbps` : ''}
          </span>
        ) : null}
      </div>

      {/* Bottom controls */}
      <div
        className={cx(
          'absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/90 to-transparent p-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-opacity duration-300',
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span data-testid="time-current">{formatClock(absTime)}</span>
          <div className="relative flex-1">
            <input
              type="range"
              min={0}
              max={totalDuration || 0}
              step={1}
              value={Math.min(absTime, totalDuration || absTime)}
              onChange={(e) => seekTo(Number(e.target.value))}
              aria-label="Seek"
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-accent [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent"
              style={{
                backgroundImage: `linear-gradient(var(--color-accent), var(--color-accent))`,
                backgroundRepeat: 'no-repeat',
                backgroundSize: `${totalDuration ? (absTime / totalDuration) * 100 : 0}% 100%`,
              }}
              data-testid="seek"
            />
            {item.markers.map((m, i) =>
              totalDuration ? (
                <span
                  key={i}
                  className="pointer-events-none absolute top-0 h-1.5 bg-white/40"
                  style={{
                    left: `${(m.startMs / 1000 / totalDuration) * 100}%`,
                    width: `${((m.endMs - m.startMs) / 1000 / totalDuration) * 100}%`,
                  }}
                />
              ) : null,
            )}
          </div>
          <span className="text-white/70">-{formatClock(remaining)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            data-testid="play-pause"
          >
            {playing ? (
              <Pause className="size-6 fill-current" />
            ) : (
              <Play className="size-6 fill-current" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => seekBy(-SEEK_STEP)}
            aria-label="Back 10 seconds"
          >
            <span className="text-xs font-bold">-10</span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => seekBy(SEEK_STEP)}
            aria-label="Forward 10 seconds"
          >
            <span className="text-xs font-bold">+10</span>
          </Button>
          {next ? (
            <Button
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={playNext}
              aria-label="Next episode"
              data-testid="next-episode"
            >
              <SkipForward className="size-6" />
            </Button>
          ) : null}
          <div className="group/vol flex items-center">
            <Button
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => video.current && (video.current.muted = !video.current.muted)}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted || volume === 0 ? (
                <VolumeX className="size-6" />
              ) : (
                <Volume2 className="size-6" />
              )}
            </Button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) =>
                video.current &&
                ((video.current.volume = Number(e.target.value)), (video.current.muted = false))
              }
              aria-label="Volume"
              className="hidden w-24 accent-accent md:block"
            />
          </div>
          <div className="flex-1" />
          {subtitleStreams.length > 0 || audioStreams.length > 1 ? (
            <div className="relative">
              <Button
                size="icon"
                variant="ghost"
                className={cx(
                  'text-white hover:bg-white/10 hover:text-white',
                  menu === 'tracks' && 'bg-white/10',
                )}
                onClick={() => setMenu(menu === 'tracks' ? 'none' : 'tracks')}
                aria-label="Audio and subtitles"
                aria-expanded={menu === 'tracks'}
                data-testid="tracks-button"
              >
                {subtitleStreams.length > 0 ? (
                  <Captions className="size-6" />
                ) : (
                  <Settings2 className="size-6" />
                )}
              </Button>
              {menu === 'tracks' ? (
                <TrackMenu
                  audio={audioStreams}
                  subtitles={subtitleStreams}
                  tracks={tracks}
                  onChange={(p) => {
                    changeTracks(p)
                    setMenu('none')
                  }}
                />
              ) : null}
            </div>
          ) : null}
          {touchDevice ? (
            <Button
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => void toggleRotate()}
              aria-label={rotated ? 'Back to portrait' : 'Rotate to landscape'}
              data-testid="rotate"
            >
              <RotateCw className={cx('size-6 transition-transform', rotated && 'rotate-90')} />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              data-testid="fullscreen"
            >
              {fullscreen ? <Minimize className="size-6" /> : <Maximize className="size-6" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Phones: rotate to landscape. Resolves true when the platform honoured the lock. */
function lockLandscape(): Promise<boolean> {
  const o = screen.orientation as ScreenOrientation & { lock?: (t: string) => Promise<void> }
  if (!o.lock) return Promise.resolve(false)
  return o.lock('landscape').then(
    () => true,
    () => false,
  )
}
/** True when the screen is physically landscape (native lock worked or the user rotated). */
function nativeLandscape(): boolean {
  return typeof window !== 'undefined' && window.innerWidth > window.innerHeight
}
function unlockOrientation() {
  try {
    screen.orientation.unlock()
  } catch {
    /* not supported or not locked */
  }
}

function defaultSubtitle(item: Item, mediaIndex: number): MediaStream | undefined {
  const subs = item.media[mediaIndex]?.parts[0]?.streams.filter((s) => s.kind === 'subtitle') ?? []
  return subs.find((s) => s.selected) ?? subs.find((s) => s.default) ?? subs[0]
}

function TrackMenu({
  audio,
  subtitles,
  tracks,
  onChange,
}: {
  audio: MediaStream[]
  subtitles: MediaStream[]
  tracks: TrackChoice
  onChange: (p: TrackChoice) => void
}) {
  const row = (active: boolean, label: string, onClick: () => void, key: string | number) => (
    <li key={key}>
      <button
        onClick={onClick}
        className={cx(
          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-white/10',
          active && 'text-accent',
        )}
        role="menuitemradio"
        aria-checked={active}
      >
        <span className={cx('size-1.5 rounded-full', active ? 'bg-accent' : 'bg-transparent')} />{' '}
        {label}
      </button>
    </li>
  )
  return (
    <div
      className="absolute bottom-12 right-0 z-10 flex max-h-[60vh] w-72 flex-col gap-3 overflow-y-auto rounded-card border border-white/10 bg-bg-2/95 p-3 shadow-2xl backdrop-blur"
      role="menu"
      data-testid="track-menu"
    >
      {audio.length > 1 ? (
        <section>
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
            Audio
          </p>
          <ul>
            {audio.map((s) =>
              row(
                tracks.audioStreamId === s.id,
                s.displayTitle,
                () => onChange({ audioStreamId: s.id }),
                s.id,
              ),
            )}
          </ul>
        </section>
      ) : null}
      {subtitles.length > 0 ? (
        <section>
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
            Subtitles
          </p>
          <ul>
            {row(!tracks.subtitleStreamId, 'Off', () => onChange({ subtitleStreamId: 0 }), 'off')}
            {subtitles.map((s) =>
              row(
                tracks.subtitleStreamId === s.id,
                s.displayTitle,
                () => onChange({ subtitleStreamId: s.id }),
                s.id,
              ),
            )}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/** Next episode lookup for autoplay: same show, first episode after the current one in season/episode order. */
export function useNextEpisode(item: Item): Item | null {
  const showKey = item.type === 'episode' ? item.grandparentRatingKey : undefined
  const all = useQuery({ ...q.allEpisodes(showKey ?? ''), enabled: Boolean(showKey) })
  if (!all.data) return null
  const idx = all.data.findIndex((e) => e.ratingKey === item.ratingKey)
  return idx >= 0 ? (all.data[idx + 1] ?? null) : null
}
