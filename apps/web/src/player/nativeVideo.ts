import type { PlaybackPlan } from '@plaguex/plex-api'
import type { NativeVideoBackend, NativeVideoEvent, NativePlayRequest } from '@/platform'
import { useSession } from '@/plex/session'
import { trackOrdinal } from './external'
import type { TrackChoice } from './plan'

/** Subset of HTMLVideoElement the player UI relies on; satisfied by both the real element and the shim. */
export type MediaLike = HTMLVideoElement | NativeVideo

export interface NativeStats {
  decoder: string
  droppedFrames: number
  renderedFrames: number
  skippedFrames: number
  maxConsecutiveDropped: number
  frameOffsetMs: number
  displayHz: number
}

const EMPTY_STATS: NativeStats = {
  decoder: '',
  droppedFrames: 0,
  renderedFrames: 0,
  skippedFrames: 0,
  maxConsecutiveDropped: 0,
  frameOffsetMs: 0,
  displayHz: 0,
}

/**
 * Drives the platform's native video surface (ExoPlayer on Android) behind the HTMLMediaElement
 * API surface the Player uses: properties, play()/pause(), and the same DOM events. The picture is
 * rendered by the OS underneath a transparent webview, so the React controls stay as they are.
 */
export class NativeVideo extends EventTarget {
  private time = 0
  private dur = 0
  private bufferedEnd = 0
  private isPaused = true
  private isEnded = false
  private isBuffering = true
  private vol = 1
  private isMuted = false
  private w = 0
  private h = 0
  private loaded = false
  private stopEvents: (() => void) | null = null
  stats: NativeStats = EMPTY_STATS
  error: { code: number; message: string } | null = null
  readonly playbackRate = 1

  constructor(private readonly backend: NativeVideoBackend) {
    super()
  }

  get currentTime() {
    return this.time
  }
  set currentTime(secs: number) {
    this.time = secs
    void this.backend.control({ action: 'seek', value: secs })
  }
  get duration() {
    return this.dur
  }
  get paused() {
    return this.isPaused
  }
  get ended() {
    return this.isEnded
  }
  get volume() {
    return this.vol
  }
  set volume(v: number) {
    this.vol = v
    void this.backend.control({ action: 'volume', value: this.isMuted ? 0 : v })
    this.emit('volumechange')
  }
  get muted() {
    return this.isMuted
  }
  set muted(m: boolean) {
    this.isMuted = m
    void this.backend.control({ action: 'volume', value: m ? 0 : this.vol })
    this.emit('volumechange')
  }
  get videoWidth() {
    return this.w
  }
  get videoHeight() {
    return this.h
  }
  get readyState() {
    return this.loaded ? (this.isBuffering ? 2 : 4) : 0
  }
  get buffered() {
    const end = this.bufferedEnd
    return { length: end > 0 ? 1 : 0, start: (_i: number) => 0, end: (_i: number) => end }
  }
  getVideoPlaybackQuality() {
    return {
      totalVideoFrames: this.stats.renderedFrames + this.stats.droppedFrames,
      droppedVideoFrames: this.stats.droppedFrames,
    }
  }
  async play() {
    await this.backend.control({ action: 'play' })
  }
  pause() {
    void this.backend.control({ action: 'pause' })
  }

  /** Starts native playback; resolves once the surface accepted the request. */
  async load(req: NativePlayRequest) {
    this.stopEvents?.()
    this.error = null
    this.isEnded = false
    this.isBuffering = true
    this.loaded = false
    this.time = req.startSecs
    this.stopEvents = await this.backend.load(req, (e) => this.onEvent(e))
  }

  /** Tears the surface down and restores the opaque webview. */
  async unload() {
    this.stopEvents?.()
    this.stopEvents = null
    await this.backend.stop()
  }

  private onEvent(e: NativeVideoEvent) {
    switch (e.type) {
      case 'state': {
        const wasPaused = this.isPaused
        const wasBuffering = this.isBuffering
        this.time = e.positionMs / 1000
        this.bufferedEnd = e.bufferedMs / 1000
        this.isPaused = !e.playing
        this.isBuffering = e.buffering
        if (e.durationMs > 0 && e.durationMs / 1000 !== this.dur) {
          this.dur = e.durationMs / 1000
          this.emit('durationchange')
        }
        if (e.width && (e.width !== this.w || e.height !== this.h)) {
          this.w = e.width
          this.h = e.height
        }
        this.stats = {
          decoder: e.decoder,
          droppedFrames: e.dropped,
          renderedFrames: e.rendered,
          skippedFrames: e.skipped ?? 0,
          maxConsecutiveDropped: e.maxConsecutiveDropped ?? 0,
          frameOffsetMs: e.frameOffsetMs ?? 0,
          displayHz: e.displayHz ?? 0,
        }
        if (!this.loaded) {
          this.loaded = true
          this.emit('loadedmetadata')
          this.emit('canplay')
        }
        if (wasPaused && !this.isPaused) this.emit('play')
        if (!wasPaused && this.isPaused) this.emit('pause')
        if (wasBuffering && !this.isBuffering) this.emit('playing')
        if (!wasBuffering && this.isBuffering) this.emit('waiting')
        this.emit('timeupdate')
        break
      }
      case 'ended':
        this.isEnded = true
        this.isPaused = true
        this.emit('pause')
        this.emit('ended')
        break
      case 'error':
        // 3 = decode, 4 = source not supported: the same codes the <video> recovery path checks.
        this.error = { code: e.fatal ? 3 : 2, message: e.message }
        this.emit('error')
        break
    }
  }

  private emit(type: string) {
    this.dispatchEvent(new Event(type))
  }
}

/** What the native player asks the server for: the raw part, plus the chosen external subtitle. */
export function buildNativeRequest(o: {
  plan: PlaybackPlan
  tracks: TrackChoice
  startSecs: number
  title: string
}): NativePlayRequest {
  const { activeServer, clientIdentifier } = useSession.getState()
  const part = o.plan.part
  const sidecar = o.plan.sidecarSubtitle
  const req: NativePlayRequest = {
    url: o.plan.url,
    title: o.title,
    startSecs: o.startSecs,
    hls: o.plan.protocol === 'hls',
    httpHeaders: activeServer
      ? { 'X-Plex-Token': activeServer.token, 'X-Plex-Client-Identifier': clientIdentifier }
      : {},
    // The plan converts the selected external subtitle to WebVTT server-side.
    subtitleFiles: sidecar
      ? [
          {
            url: sidecar.url,
            mime: 'text/vtt',
            language: sidecar.stream.languageCode ?? '',
            label: sidecar.stream.displayTitle,
          },
        ]
      : [],
    embeddedSubtitleCount: part.streams.filter((s) => s.kind === 'subtitle' && !s.external).length,
  }
  if (o.tracks.audioStreamId) {
    const a = trackOrdinal(part, o.tracks.audioStreamId)
    if (a) req.audioTrack = a
  }
  if (!o.tracks.subtitleStreamId) req.subtitleTrack = 0
  else if (sidecar) req.subtitleTrack = req.embeddedSubtitleCount + 1
  else {
    const ord = trackOrdinal(part, o.tracks.subtitleStreamId)
    if (ord) req.subtitleTrack = ord
  }
  return req
}
