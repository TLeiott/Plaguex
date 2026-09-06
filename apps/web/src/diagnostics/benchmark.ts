import {
  probeConnections,
  type Item,
  type PlaybackPlan,
  type PlayerCapabilities,
} from '@plaguex/plex-api'
import { activeServer, plexTv } from '@/plex/api'
import { useSession } from '@/plex/session'
import { buildClientInfo, APP_VERSION } from '@/plex/client-info'
import { platform } from '@/platform'
import { useDownloads } from '@/downloads/store'
import { buildPlan, defaultTracks, newSessionId } from '@/player/plan'
import { logEntries } from './log'
import { NativeVideo, buildNativeRequest } from '@/player/nativeVideo'
import { NATIVE_CAPS } from '@/player/Player'

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
  /** Presented frames observed via requestVideoFrameCallback. */
  presentedFrames: number
  /** Median gap between presented frames, ms (≈ 1000 / fps when smooth). */
  medianFrameGapMs: number
  /** Presented-frame gaps > 1.5× the median: visible hitches/jumps. */
  hitches: number
  worstFrameGapMs: number
  /** Main-thread rAF gaps > 50 ms (UI jank that also delays compositing). */
  longFrames: number
  worstLongFrameMs: number
  /** Backend-specific detail line (native decoder counters). */
  extra?: string
  error: string | null
}

export interface Report {
  generatedAt: string
  app: Record<string, unknown>
  device: Record<string, unknown>
  /** Thermal, power, display and decoder facts from the OS (Android). */
  nativeDevice: Record<string, unknown> | null
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

/** Frame-pacing observer: presented-frame gaps (rVFC) and main-thread jank (rAF). */
function observePacing(el: HTMLVideoElement) {
  const gaps: number[] = []
  let longFrames = 0
  let worstLong = 0
  let lastPresented: number | null = null
  let lastRaf: number | null = null
  let stopped = false
  const rvfc = (
    el as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        cb: (now: number, meta: { presentedFrames: number }) => void,
      ) => void
    }
  ).requestVideoFrameCallback?.bind(el)
  const onFrame = (now: number) => {
    if (stopped) return
    if (lastPresented !== null) gaps.push(now - lastPresented)
    lastPresented = now
    rvfc?.(onFrame)
  }
  const onRaf = (now: number) => {
    if (stopped) return
    if (lastRaf !== null && now - lastRaf > 50) {
      longFrames++
      worstLong = Math.max(worstLong, now - lastRaf)
    }
    lastRaf = now
    requestAnimationFrame(onRaf)
  }
  rvfc?.(onFrame)
  requestAnimationFrame(onRaf)
  return {
    stop() {
      stopped = true
      const sorted = [...gaps].sort((a, b) => a - b)
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0
      // Anything past 1.5 frame intervals means at least one vsync showed a stale frame.
      const hitches = median ? gaps.filter((g) => g > median * 1.5).length : 0
      return {
        presentedFrames: gaps.length + (lastPresented === null ? 0 : 1),
        medianFrameGapMs: Math.round(median * 10) / 10,
        hitches,
        worstFrameGapMs: Math.round(sorted.at(-1) ?? 0),
        longFrames,
        worstLongFrameMs: Math.round(worstLong),
      }
    },
  }
}

/**
 * Plays `url` for `seconds` in a full-screen, visible <video> (immersive on Android, like the real
 * player) and measures start-up, stalls, dropped frames and frame pacing. Rendering on screen
 * matters: an off-screen 320px element never exercises the compositor and hides real stutter.
 */
export async function probePlayback(
  label: string,
  source: string,
  url: string,
  seconds: number,
  onProgress?: Progress,
): Promise<PlaybackProbe> {
  const native = platform().screen
  const host = document.createElement('div')
  host.dataset.testid = 'probe-stage'
  host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000'
  const el = document.createElement('video')
  el.muted = true
  el.playsInline = true
  el.preload = 'auto'
  el.style.cssText = 'width:100%;height:100%;object-fit:contain'
  const hud = document.createElement('div')
  hud.style.cssText =
    'position:absolute;left:12px;top:12px;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,.6);color:#fff;font:12px ui-monospace,monospace;white-space:pre;pointer-events:none'
  hud.textContent = `${label}\nstarting…`
  host.append(el, hud)
  document.body.appendChild(host)
  await native?.setImmersive(true).catch(() => undefined)
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
    presentedFrames: 0,
    medianFrameGapMs: 0,
    hitches: 0,
    worstFrameGapMs: 0,
    longFrames: 0,
    worstLongFrameMs: 0,
    error: null,
  }
  const t0 = performance.now()
  let stallStart: number | null = null
  let pacing: ReturnType<typeof observePacing> | undefined
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
    pacing = observePacing(el)
    const deadline = performance.now() + seconds * 1000
    while (performance.now() < deadline) {
      await Promise.race([new Promise((r) => setTimeout(r, 500)), errored])
      const ahead = el.buffered.length
        ? el.buffered.end(el.buffered.length - 1) - el.currentTime
        : 0
      probe.minBufferAheadSecs = Math.min(probe.minBufferAheadSecs, ahead)
      const q = el.getVideoPlaybackQuality?.()
      const msg = `${label}: ${el.currentTime.toFixed(1)} s played, ${probe.stalls} stalls`
      hud.textContent = `${msg}\nbuffer ahead ${ahead.toFixed(1)} s · dropped ${q?.droppedVideoFrames ?? '?'}/${q?.totalVideoFrames ?? '?'} · ${el.videoWidth}x${el.videoHeight}`
      onProgress?.(msg)
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
    if (pacing) Object.assign(probe, pacing.stop())
    el.removeEventListener('waiting', onWaiting)
    el.removeEventListener('playing', onPlaying)
    hls?.destroy()
    el.pause()
    el.removeAttribute('src')
    el.load()
    host.remove()
    await native?.setImmersive(false).catch(() => undefined)
  }
  return probe
}

const CODEC_MIME: Record<string, string> = {
  hevc: 'video/hevc',
  h264: 'video/avc',
  av1: 'video/av01',
}

/** Decoder names from the device-state report for `codec`, minus the one already measured. */
export function alternativeDecoders(
  device: Record<string, unknown> | null,
  codec: string | undefined,
  used: string | undefined,
): string[] {
  const mime = CODEC_MIME[codec ?? '']
  const list = device?.decoders
  if (!mime || !Array.isArray(list)) return []
  return list
    .map((line) => /^(\S+) \[([^\]]+)\]/.exec(String(line)))
    .filter((m): m is RegExpExecArray => m !== null && m[2] === mime && m[1] !== used)
    .map((m) => m[1]!)
}

/**
 * Same measurement for the native surface (ExoPlayer): the picture is composited by the OS, so
 * frame pacing comes from the decoder counters instead of requestVideoFrameCallback.
 */
export async function probeNative(
  label: string,
  source: string,
  plan: PlaybackPlan,
  seconds: number,
  onProgress?: Progress,
  opts: { disableAudio?: boolean; decoder?: string } = {},
): Promise<PlaybackProbe> {
  const backend = platform().nativeVideo
  const native = platform().screen
  const probe: PlaybackProbe = {
    label,
    source,
    url: plan.url.replace(/X-Plex-Token=[^&]+/g, 'X-Plex-Token=…'),
    timeToFirstFrameMs: null,
    playedSecs: 0,
    stalls: 0,
    stalledMs: 0,
    droppedFrames: 0,
    totalFrames: 0,
    decoded: '',
    minBufferAheadSecs: Infinity,
    presentedFrames: 0,
    medianFrameGapMs: 0,
    hitches: 0,
    worstFrameGapMs: 0,
    longFrames: 0,
    worstLongFrameMs: 0,
    error: null,
  }
  if (!backend) {
    probe.error = 'native player not available'
    return probe
  }
  const el = new NativeVideo(backend)
  document.documentElement.classList.add('plaguex-native-video')
  const host = document.createElement('div')
  host.dataset.testid = 'probe-stage'
  host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:transparent'
  const hud = document.createElement('div')
  hud.style.cssText =
    'position:absolute;left:12px;top:12px;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,.6);color:#fff;font:12px ui-monospace,monospace;white-space:pre;pointer-events:none'
  hud.textContent = `${label}\nstarting…`
  host.append(hud)
  document.body.appendChild(host)
  await native?.setImmersive(true).catch(() => undefined)
  const t0 = performance.now()
  let stallStart: number | null = null
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
    el.addEventListener('error', () => reject(new Error(el.error?.message ?? 'native error')), {
      once: true,
    })
  })
  let pacing: ReturnType<typeof observePacing> | undefined
  try {
    await el.load({
      ...buildNativeRequest({ plan, tracks: {}, startSecs: 0, title: label }),
      ...(opts.disableAudio ? { disableAudio: true } : {}),
      ...(opts.decoder ? { decoder: opts.decoder } : {}),
    })
    // rVFC does not exist for a native surface; keep the rAF jank counter only.
    pacing = observePacing(document.createElement('video'))
    const deadline = performance.now() + seconds * 1000
    while (performance.now() < deadline) {
      await Promise.race([new Promise((r) => setTimeout(r, 500)), errored])
      const ahead = el.buffered.length ? el.buffered.end(0) - el.currentTime : 0
      if (el.readyState > 0) probe.minBufferAheadSecs = Math.min(probe.minBufferAheadSecs, ahead)
      const msg = `${label}: ${el.currentTime.toFixed(1)} s played, ${probe.stalls} stalls`
      hud.textContent = `${msg}\n${el.stats.decoder || 'decoder pending'} · dropped ${el.stats.droppedFrames}/${el.stats.renderedFrames} · ${el.videoWidth}x${el.videoHeight}`
      onProgress?.(msg)
      if (el.ended) break
    }
  } catch (e) {
    probe.error = e instanceof Error ? e.message : String(e)
  } finally {
    probe.playedSecs = Math.round(el.currentTime * 10) / 10
    probe.droppedFrames = el.stats.droppedFrames
    probe.totalFrames = el.stats.renderedFrames + el.stats.droppedFrames
    probe.decoded = el.videoWidth
      ? `${el.videoWidth}x${el.videoHeight} via ${el.stats.decoder || 'unknown decoder'}`
      : 'none'
    if (!Number.isFinite(probe.minBufferAheadSecs)) probe.minBufferAheadSecs = 0
    if (pacing) {
      const p = pacing.stop()
      probe.longFrames = p.longFrames
      probe.worstLongFrameMs = p.worstLongFrameMs
    }
    const st = el.stats
    probe.extra = `native: skipped ${st.skippedFrames} · max consecutive dropped ${st.maxConsecutiveDropped} · avg frame offset ${st.frameOffsetMs.toFixed(1)} ms (negative = decoder late) · display ${st.displayHz.toFixed(0)} Hz${opts.disableAudio ? ' · audio disabled' : ''}${opts.decoder ? ` · requested decoder ${opts.decoder}` : ''}`
    await el.unload().catch(() => undefined)
    host.remove()
    document.documentElement.classList.remove('plaguex-native-video')
    await native?.setImmersive(false).catch(() => undefined)
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
  let libraryItems: Item[] = []
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
      libraryItems = page.items
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

  let nativeDevice: Record<string, unknown> | null = null
  if (p.deviceInfo) {
    onProgress('Reading device state')
    nativeDevice = await p.deviceInfo().catch(() => null)
  }

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
  if (localUrl && p.nativeVideo) {
    onProgress('Playing a downloaded file with the native player')
    const first = done[0]!
    const media = first.item.media[0]
    const part = media?.parts[0]
    if (media && part) {
      const localPlan: PlaybackPlan = {
        method: 'directplay',
        protocol: 'file',
        url: localUrl,
        mediaIndex: 0,
        partIndex: 0,
        media,
        part,
        sessionId: newSessionId(),
        reasons: [],
      }
      playback.push(
        await probeNative(
          `Native downloaded: ${first.item.title}`,
          'local file · ExoPlayer',
          localPlan,
          playbackSeconds,
          onProgress,
        ),
      )
      // Same file without audio: if drops vanish, the audio clock (not the decoder) forces them.
      onProgress('Playing the downloaded file video-only')
      playback.push(
        await probeNative(
          `Native downloaded, video only: ${first.item.title}`,
          'local file · ExoPlayer · audio disabled',
          { ...localPlan, sessionId: newSessionId() },
          playbackSeconds,
          onProgress,
          { disableAudio: true },
        ),
      )
      // Every other decoder the device has for this codec: finds one that keeps up when the
      // default one drops frames (as the Qualcomm HEVC decoder did on a plain x265 file).
      const used = /via (\S+)/.exec(playback.at(-2)?.decoded ?? '')?.[1]
      for (const name of alternativeDecoders(nativeDevice, media.videoCodec, used)) {
        onProgress(`Playing the downloaded file via ${name}`)
        playback.push(
          await probeNative(
            `Native downloaded via ${name}: ${first.item.title}`,
            'local file · ExoPlayer',
            { ...localPlan, sessionId: newSessionId() },
            playbackSeconds,
            onProgress,
            { decoder: name },
          ),
        )
      }
    }
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
      if (p.nativeVideo) {
        onProgress('Streaming with the native player')
        const nativePlan = buildPlan({
          item: firstItem,
          caps: NATIVE_CAPS,
          tracks: defaultTracks(firstItem, 0),
          startMs: 0,
          sessionId: newSessionId(),
        })
        playback.push(
          await probeNative(
            `Native stream: ${firstItem.title}`,
            `${nativePlan.method} · ${nativePlan.protocol} · ExoPlayer`,
            nativePlan,
            playbackSeconds,
            onProgress,
          ),
        )
        // A different codec from the same library: separates "this decoder" from "this device".
        const firstCodec = firstItem.media[0]?.videoCodec ?? ''
        const other = libraryItems.find(
          (i) =>
            i.ratingKey !== firstItem!.ratingKey &&
            i.media.length > 0 &&
            (i.media[0]?.videoCodec ?? '') !== firstCodec &&
            (i.media[0]?.videoCodec === 'h264' || firstCodec === 'h264'),
        )
        if (other) {
          onProgress(`Streaming a ${other.media[0]?.videoCodec ?? ''} title natively`)
          const otherPlan = buildPlan({
            item: other,
            caps: NATIVE_CAPS,
            tracks: defaultTracks(other, 0),
            startMs: 0,
            sessionId: newSessionId(),
          })
          playback.push(
            await probeNative(
              `Native stream (${other.media[0]?.videoCodec ?? '?'} ${other.media[0]?.height ?? '?'}p): ${other.title}`,
              `${otherPlan.method} · ${otherPlan.protocol} · ExoPlayer`,
              otherPlan,
              playbackSeconds,
              onProgress,
            ),
          )
        }
      }
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
        presentedFrames: 0,
        medianFrameGapMs: 0,
        hitches: 0,
        worstFrameGapMs: 0,
        longFrames: 0,
        worstLongFrameMs: 0,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    nativeDevice,
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
  if (r.nativeDevice) {
    lines.push('## Device state (OS)')
    for (const [k, v] of Object.entries(r.nativeDevice)) {
      if (Array.isArray(v)) lines.push(`${k}:`, ...v.map((x) => `  - ${String(x)}`))
      else lines.push(`${k}: ${String(v)}`)
    }
    lines.push('')
  }
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
      `pacing: ${p.presentedFrames} presented · median gap ${p.medianFrameGapMs} ms · ${p.hitches} hitches (>1.5× gap) · worst gap ${p.worstFrameGapMs} ms`,
      `main thread: ${p.longFrames} long frames (>50 ms) · worst ${p.worstLongFrameMs} ms`,
      ...(p.extra ? [p.extra] : []),
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
