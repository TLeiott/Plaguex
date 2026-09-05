import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ArrowLeft, MonitorPlay } from 'lucide-react'
import type { Item } from '@plaguex/plex-api'
import { activeServer } from '@/plex/api'
import { platform, type ExternalPlayerEvent } from '@/platform'
import { Button, Spinner } from '@/components/ui'
import { formatClock } from '@/lib/format'
import { buildExternalRequest } from './external'
import { defaultTracks } from './plan'

interface Props {
  item: Item
  startMs: number
  next: Item | null
}

/**
 * Hands playback to the native player (mpv). The webview shows a small status card while mpv owns
 * the screen, keeps Plex's timeline in sync from mpv's progress events, and returns when it exits.
 */
export function ExternalSession({ item, startMs, next }: Props) {
  const navigate = useNavigate()
  const [state, setState] = useState<'starting' | 'playing' | 'error'>('starting')
  const [error, setError] = useState<string | null>(null)
  const [pos, setPos] = useState({ time: startMs / 1000, paused: false })
  const lastPing = useRef(0)
  const lastTime = useRef(startMs / 1000)
  const [sessionId] = useState(() => crypto.randomUUID())

  useEffect(() => {
    const player = platform().externalPlayer
    if (!player) return
    const durationMs = item.durationMs ?? 0
    const server = activeServer()
    const ping = (state: 'playing' | 'paused' | 'stopped', timeSecs: number) =>
      server
        .timeline({
          ratingKey: item.ratingKey,
          key: item.key,
          state,
          timeMs: Math.floor(timeSecs * 1000),
          durationMs,
        })
        .catch(() => undefined)

    let ended = false
    const unsubscribe = player.subscribe((e: ExternalPlayerEvent) => {
      if (e.sessionId !== sessionId) return
      if (e.type === 'started') setState('playing')
      if (e.type === 'progress') {
        if (!Number.isFinite(e.timeSecs)) return
        lastTime.current = e.timeSecs
        setPos({ time: e.timeSecs, paused: e.paused })
        const now = Date.now()
        if (e.paused || now - lastPing.current > 10_000) {
          lastPing.current = now
          void ping(e.paused ? 'paused' : 'playing', e.timeSecs)
        }
      }
      if (e.type === 'ended') {
        ended = true
        const at = Number.isFinite(e.timeSecs) ? e.timeSecs : lastTime.current
        void ping('stopped', at)
        const nearEnd = durationMs > 0 && at * 1000 > durationMs * 0.9
        if (e.reason === 'error') {
          setState('error')
          setError('mpv exited with an error')
          return
        }
        if (e.reason === 'eof' && nearEnd && next) {
          void navigate({
            to: '/play/$ratingKey',
            params: { ratingKey: next.ratingKey },
            replace: true,
          })
        } else {
          void navigate({
            to: '/item/$ratingKey',
            params: { ratingKey: item.ratingKey },
            replace: true,
          })
        }
      }
    })

    const tracks = defaultTracks(item, 0)
    void player
      .play(buildExternalRequest({ item, mediaIndex: 0, startMs, ...tracks }), sessionId)
      .catch((e: unknown) => {
        setState('error')
        setError(e instanceof Error ? e.message : String(e))
      })

    return () => {
      unsubscribe()
      if (!ended) void player.stop(sessionId)
    }
  }, [item, startMs, next, navigate, sessionId])

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-6 bg-black p-6 text-center text-white"
      data-testid="external-session"
    >
      {state === 'error' ? (
        <AlertTriangle className="size-12 text-danger" />
      ) : (
        <MonitorPlay className="size-12 text-accent" />
      )}
      <div>
        <h1 className="text-2xl font-semibold">
          {item.type === 'episode' ? item.grandparentTitle : item.title}
        </h1>
        <p className="mt-1 text-white/70">
          {state === 'starting'
            ? 'Starting mpv…'
            : state === 'playing'
              ? `Playing in mpv · ${formatClock(pos.time)}${pos.paused ? ' (paused)' : ''}`
              : error}
        </p>
      </div>
      {state === 'starting' ? <Spinner className="text-white" /> : null}
      <Button
        variant="ghost"
        className="text-white hover:bg-white/10 hover:text-white"
        onClick={() =>
          void navigate({
            to: '/item/$ratingKey',
            params: { ratingKey: item.ratingKey },
            replace: true,
          })
        }
      >
        <ArrowLeft className="size-5" /> Back
      </Button>
    </div>
  )
}
