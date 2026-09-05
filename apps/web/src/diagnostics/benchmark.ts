import { probeConnections, type Item, type PlayerCapabilities } from '@plaguex/plex-api'
import { activeServer, plexTv } from '@/plex/api'
import { useSession } from '@/plex/session'
import { buildClientInfo, APP_VERSION } from '@/plex/client-info'
import { platform } from '@/platform'
import { useDownloads } from '@/downloads/store'
import { buildPlan, defaultTracks, newSessionId } from '@/player/plan'
import { logEntries } from './log'

export interface StepResult {
  name: string
  status: 'ok' | 'warn' | 'fail' | 'skip'
  ms: number
  detail: string
  data?: Record<string, unknown>
}

export interface PlaybackProbe {
  label: string
  source: string
  url: string
  timeToFirstFrameMs: number | null
  playedSecs: number
  stalls: number
  stalledMs: number
  droppedFrames: number
  totalFrames: number
  decoded: string
  minBufferAheadSecs: number
  error: string | null
}

export interface Report {
  generatedAt: string
  app: Record<string, unknown>
  device: Record<string, unknown>
  settings: Record<string, unknown>
  capabilities: PlayerCapabilities | null
  steps: StepResult[]
  playback: PlaybackProbe[]
  downloads: Record<string, unknown>[]
  log: ReturnType<typeof logEntries>
}

export type Progress = (message: string) => void

const timed = async (
  name: string,
  fn: () => Promise<{
    detail: string
    status?: StepResult['status']
    data?: Record<string, unknown>
  }>,
): Promise<StepResult> => {
  const t0 = performance.now()
  try {
    const r = await fn()
    return {
      name,
      status: r.status ?? 'ok',
      ms: Math.round(performance.now() - t0),
      detail: r.detail,
      ...(r.data ? { data: r.data } : {}),
    }
  } catch (e) {
    return {
      name,
      status: 'fail',
      ms: Math.round(performance.now() - t0),
      detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    }
  }
}

/**
 * Plays `url` muted in a detached <video> for `seconds` and measures start-up, stalls and frame
 * drops. Uses the real media pipeline of the runtime, so results reflect what the player sees.
 */
export async function probePlayback(
  label: string,
  source: string,
  url: string,
  seconds: number,
  onProgress?: Progress,
): Promise<PlaybackProbe> {
  const el = document.createElement('video')
  el.muted = true
  el.playsInline = true
  el.preload = 'auto'
  el.style.cssText =
    'position:fixed;left:-9999px;top:0;width:320px;height:180px;opacity:0.01;pointer-events:none'
  document.body.appendChild(el)
  const probe: PlaybackProbe = {
    label,
    source,
    url: url.replace(/X-Plex-Token=[^&]+/g, 'X-Plex-Token=…'),
    timeToFirstFrameMs: null,
    playedSecs: 0,
    stalls: 0,
    stalledMs: 0,
    droppedFrames: 0,
    totalFrames: 0,
    decoded: '',
    minBufferAheadSecs: Infinity,
    error: null,
  }
  const t0 = performance.now()
  let stallStart: number | null = null
  let hls: { destroy(): void } | null = null
  const onWaiting = () => {
    probe.stalls++
    stallStart = performance.now()
  }
  const onPlaying = () => {
    if (probe.timeToFirstFrameMs === null)
      probe.timeToFirstFrameMs = Math.round(performance.now() - t0)
    if (stallStart !== null) {
      probe.stalledMs += Math.round(performance.now() - stallStart)
      stallStart = null
    }
  }
  el.addEventListener('waiting', onWaiting)
  el.addEventListener('playing', onPlaying)
  const errored = new Promise<never>((_, reject) => {
    el.addEventListener(
      'error',
      () =>
        reject(
          new Error(el.error ? `media error ${el.error.code}: ${el.error.message}` : 'media error'),
        ),
      { once: true },
    )
  })
  try {
    if (/\.m3u8(\?|$)/.test(url)) {
      const { default: Hls } = await import('hls.js')
      if (Hls.isSupported()) {
        const h = new Hls({ enableWorker: true })
        hls = h
        h.on(Hls.Events.ERROR, (_e, d) => {
          if (d.fatal) probe.error = `${d.type}: ${d.details}`
        })
        h.loadSource(url)
        h.attachMedia(el)
      } else el.src = url
    } else {
      el.src = url
    }
    await Promise.race([el.play(), errored])
    const deadline = performance.now() + seconds * 1000
    while (performance.now() < deadline) {
      await Promise.race([new Promise((r) => setTimeout(r, 500)), errored])
      const ahead = el.buffered.length
        ? el.buffered.end(el.buffered.length - 1) - el.currentTime
        : 0
      probe.minBufferAheadSecs = Math.min(probe.minBufferAheadSecs, ahead)
      onProgress?.(`${label}: ${el.currentTime.toFixed(1)} s played, ${probe.stalls} stalls`)
      if (el.ended) break
    }
  } catch (e) {
    probe.error = e instanceof Error ? e.message : String(e)
  } finally {
    const q = el.getVideoPlaybackQuality?.()
    probe.playedSecs = Math.round(el.currentTime * 10) / 10
    probe.droppedFrames = q?.droppedVideoFrames ?? 0
    probe.totalFrames = q?.totalVideoFrames ?? 0
    probe.decoded = el.videoWidth ? `${el.videoWidth}x${el.videoHeight}` : 'none'
    if (!Number.isFinite(probe.minBufferAheadSecs)) probe.minBufferAheadSecs = 0
    el.removeEventListener('waiting', onWaiting)
    el.removeEventListener('playing', onPlaying)
    hls?.destroy()
    el.pause()
    el.removeAttribute('src')
    el.load()
    el.remove()
  }
  return probe
}

/** Runs the whole suite. Every step is isolated: a failure is recorded, never thrown. */
export async function runBenchmark(
  onProgress: Progress = () => undefined,
  opts: { playbackSeconds?: number } = {},
): Promise<Report> {
  const playbackSeconds = opts.playbackSeconds ?? 15
  const session = useSession.getState()
  const p = platform()
  const steps: StepResult[] = []
  const playback: PlaybackProbe[] = []
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; type?: string }
    deviceMemory?: number
  }
  let caps: PlayerCapabilities | null = null

  onProgress('Probing device capabilities')
  steps.push(
    await timed('Capability probe', async () => {
      caps = await p.probeCapabilities()
      return {
        detail: `video ${caps.videoCodecs.join('/') || 'none'} · audio ${caps.audioCodecs.join('/') || 'none'} · containers ${caps.containers.join('/') || 'none'} · hdr ${caps.hdr ? 'yes' : 'no'}`,
      }
    }),
  )

  onProgress('Contacting plex.tv')
  steps.push(
    await timed('plex.tv account', async () => {
      if (!session.accountToken) return { status: 'skip', detail: 'not signed in' }
      const user = await plexTv().user(session.accountToken)
      return { detail: `signed in as ${user.title}` }
    }),
  )

  let servers: Awaited<ReturnType<ReturnType<typeof plexTv>['servers']>> = []
  steps.push(
    await timed('Server list', async () => {
      if (!session.accountToken) return { status: 'skip', detail: 'not signed in' }
      servers = await plexTv().servers(session.accountToken)
      return {
        detail:
          servers
            .map(
              (s) =>
                `${s.name} (${s.owned ? 'owned' : 'shared'}, ${s.connections.length} connections)`,
            )
            .join('; ') || 'none',
      }
    }),
  )

  onProgress('Racing server connections')
  steps.push(
    await timed('Connection latency', async () => {
      const s =
        servers.find((x) => x.clientIdentifier === session.activeServer?.clientIdentifier) ??
        servers[0]
      if (!s) return { status: 'skip', detail: 'no server' }
      const r = await probeConnections(s, buildClientInfo(session.clientIdentifier), {
        timeoutMs: 5000,
      })
      const unreachable = s.connections.length - r.length
      return {
        detail:
          r
            .map(
              (c) =>
                `${c.connection.local ? 'local' : c.connection.relay ? 'relay' : 'remote'} ${c.connection.uri} ${c.latencyMs} ms`,
            )
            .join('; ') + (unreachable ? ` · ${unreachable} unreachable` : ''),
        status: r.length ? 'ok' : 'fail',
      }
    }),
  )

  let firstItem: Item | undefined
  steps.push(
    await timed('Libraries', async () => {
      const libs = await activeServer().libraries()
      return { detail: libs.map((l) => `${l.title} (${l.type})`).join(', ') }
    }),
  )
  steps.push(
    await timed('Continue watching / on deck', async () => {
      const s = activeServer()
      const cw = await s.continueWatching(10)
      const od = cw.length ? cw : await s.onDeck(10)
      firstItem = od.find((i) => i.media.length > 0)
      return { detail: `${cw.length} continue watching, ${od.length} on deck` }
    }),
  )
  steps.push(
    await timed('Library page (60 items)', async () => {
      const libs = await activeServer().libraries()
      const lib = libs.find((l) => l.type === 'movie') ?? libs[0]
      if (!lib) return { status: 'skip', detail: 'no library' }
      const page = await activeServer().libraryItems(lib.id, { limit: 60 })
      firstItem ??= page.items.find((i) => i.media.length > 0)
      return { detail: `${page.items.length} of ${page.total} items from ${lib.title}` }
    }),
  )
  steps.push(
    await timed('Search', async () => {
      const hubs = await activeServer().search('the', 10)
      return {
        detail: `${hubs.reduce((n, h) => n + h.items.length, 0)} results in ${hubs.length} hubs`,
      }
    }),
  )
  steps.push(
    await timed('Poster image (400x600)', async () => {
      if (!firstItem?.thumb) return { status: 'skip', detail: 'no image' }
      const url = activeServer().imageUrl(firstItem.thumb, 400, 600)
      const res = await fetch(url)
      const blob = await res.blob()
      return {
        detail: `${res.status} · ${Math.round(blob.size / 1024)} KB`,
        status: res.ok ? 'ok' : 'fail',
      }
    }),
  )

  // Downloads + loopback server
  const dl = Object.values(useDownloads.getState().items)
  const done = dl.filter((d) => d.status === 'done')
  steps.push(
    await timed('Downloads state', () => {
      return Promise.resolve({
        detail: `${dl.length} total · ${done.length} done · ${dl.filter((d) => d.status === 'downloading').length} downloading · ${dl.filter((d) => d.status === 'error').length} errors`,
        status: dl.some((d) => d.status === 'error') ? 'warn' : 'ok',
      })
    }),
  )
  let localUrl: string | null = null
  steps.push(
    await timed('Local file server throughput', async () => {
      const first = done[0]
      if (!first || !p.downloads) return { status: 'skip', detail: 'no completed download' }
      localUrl = await p.downloads.playbackUrl(first.id)
      if (!localUrl) return { status: 'fail', detail: 'no local URL for a completed download' }
      const t0 = performance.now()
      const res = await fetch(localUrl, { headers: { Range: 'bytes=0-33554431' } })
      const buf = await res.arrayBuffer()
      const secs = (performance.now() - t0) / 1000
      const mbps = buf.byteLength / 1e6 / secs
      return {
        detail: `${res.status} · ${(buf.byteLength / 1e6).toFixed(0)} MB in ${secs.toFixed(2)} s = ${mbps.toFixed(0)} MB/s · accept-ranges ${res.headers.get('accept-ranges') ?? '-'}`,
        status: res.status === 206 && mbps > 20 ? 'ok' : 'warn',
      }
    }),
  )

  // Playback probes
  if (localUrl) {
    onProgress('Playing a downloaded file')
    const first = done[0]!
    playback.push(
      await probePlayback(
        `Downloaded: ${first.item.title}`,
        `local ${first.fileName}${first.choice?.kind === 'transcode' ? ` (re-encoded ${first.choice.preset.label})` : ' (original)'}`,
        localUrl,
        playbackSeconds,
        onProgress,
      ),
    )
  }
  if (firstItem && caps) {
    onProgress('Streaming from the server')
    try {
      const plan = buildPlan({
        item: firstItem,
        caps,
        tracks: defaultTracks(firstItem, 0),
        startMs: 0,
        sessionId: newSessionId(),
      })
      playback.push(
        await probePlayback(
          `Stream: ${firstItem.title}`,
          `${plan.method} · ${plan.protocol}${plan.reasons.length ? ` · ${plan.reasons.join(', ')}` : ''}`,
          plan.url,
          playbackSeconds,
          onProgress,
        ),
      )
      if (plan.protocol === 'hls') void activeServer().stopTranscodeSession(plan.sessionId)
    } catch (e) {
      playback.push({
        label: `Stream: ${firstItem.title}`,
        source: 'plan failed',
        url: '',
        timeToFirstFrameMs: null,
        playedSecs: 0,
        stalls: 0,
        stalledMs: 0,
        droppedFrames: 0,
        totalFrames: 0,
        decoded: '',
        minBufferAheadSecs: 0,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: APP_VERSION,
      platform: p.kind,
      userAgent: navigator.userAgent,
      language: navigator.language,
      online: navigator.onLine,
    },
    device: {
      screen: `${screen.width}x${screen.height} @${window.devicePixelRatio}x`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      orientation: screen.orientation?.type,
      connection: nav.connection
        ? `${nav.connection.type ?? ''} ${nav.connection.effectiveType ?? ''} ${nav.connection.downlink ?? ''} Mbps`.trim()
        : 'unknown',
      deviceMemoryGb: nav.deviceMemory ?? 'unknown',
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
    settings: {
      ...session.settings,
      server: session.activeServer
        ? `${session.activeServer.name} via ${session.activeServer.baseUrl}`
        : null,
    },
    capabilities: caps,
    steps,
    playback,
    downloads: dl.map((d) => ({
      id: d.id,
      title: d.item.title,
      status: d.status,
      receivedBytes: d.receivedBytes,
      totalBytes: d.totalBytes,
      choice: d.choice?.kind === 'transcode' ? d.choice.preset.id : (d.choice?.kind ?? 'original'),
      error: d.error ?? null,
    })),
    log: logEntries(),
  }
}

/** Human-readable report (what gets shared). */
export function formatReport(r: Report): string {
  const lines: string[] = []
  lines.push(`Plaguex diagnostics · ${r.generatedAt}`, '')
  lines.push('## App', ...Object.entries(r.app).map(([k, v]) => `${k}: ${String(v)}`), '')
  lines.push('## Device', ...Object.entries(r.device).map(([k, v]) => `${k}: ${String(v)}`), '')
  lines.push('## Settings', ...Object.entries(r.settings).map(([k, v]) => `${k}: ${String(v)}`), '')
  lines.push('## Capabilities', r.capabilities ? JSON.stringify(r.capabilities) : 'n/a', '')
  lines.push('## Checks')
  for (const s of r.steps)
    lines.push(`[${s.status.toUpperCase().padEnd(4)}] ${s.name} (${s.ms} ms): ${s.detail}`)
  lines.push('', '## Playback probes')
  if (r.playback.length === 0) lines.push('none')
  for (const p of r.playback) {
    lines.push(
      `### ${p.label}`,
      `source: ${p.source}`,
      `url: ${p.url}`,
      `first frame: ${p.timeToFirstFrameMs ?? 'never'} ms · played ${p.playedSecs} s`,
      `stalls: ${p.stalls} (${p.stalledMs} ms) · min buffer ahead ${p.minBufferAheadSecs.toFixed(1)} s`,
      `frames: ${p.totalFrames} total, ${p.droppedFrames} dropped (${p.totalFrames ? ((p.droppedFrames / p.totalFrames) * 100).toFixed(1) : '0'}%) · decoded ${p.decoded}`,
      `error: ${p.error ?? 'none'}`,
      '',
    )
  }
  lines.push('## Downloads')
  if (r.downloads.length === 0) lines.push('none')
  for (const d of r.downloads)
    lines.push(
      `${String(d.status).padEnd(11)} ${String(d.title)} · ${String(d.choice)} · ${String(d.receivedBytes)}/${String(d.totalBytes)}${typeof d.error === 'string' && d.error ? ` · ${d.error}` : ''}`,
    )
  lines.push('', `## Log (${r.log.length} entries)`)
  for (const e of r.log) lines.push(`${e.at} ${e.level.toUpperCase()} ${e.message}`)
  return lines.join('\n')
}
