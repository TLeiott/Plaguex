import { plexQuery, type PlexClientInfo } from './headers'
import { buildUrl } from './http'
import type { Item, MediaPart, MediaStream, MediaVersion } from './types'

/** What the local player can decode without help from the server. */
export interface PlayerCapabilities {
  /** lower-case container names: mp4, mkv, webm, mov ... */
  containers: string[]
  /** lower-case codecs as Plex reports them: h264, hevc, av1, vp9, mpeg4 ... */
  videoCodecs: string[]
  audioCodecs: string[]
  /** Text subtitle formats the player renders itself (srt, ass, vtt, mov_text). Image subs (pgs, vobsub) always need burn-in. */
  subtitleFormats: string[]
  maxHeight?: number
  maxBitrateKbps?: number
  /** Whether 10-bit HDR video can be shown. If false, HDR sources get transcoded (tone-mapped) by the server. */
  hdr?: boolean
}

export interface PlaybackPrefs {
  /** Force a transcode quality cap in kbps (Plex "quality" setting). undefined = original. */
  maxBitrateKbps?: number
  audioStreamId?: number
  /** 0 or undefined = no subtitles */
  subtitleStreamId?: number
  /** Where the client is relative to the server. Affects Plex's default bandwidth choices. */
  location?: 'lan' | 'wan'
  /** Resume position in ms */
  startMs?: number
}

export type PlayMethod = 'directplay' | 'directstream' | 'transcode'

export interface PlaybackPlan {
  method: PlayMethod
  /** Fully qualified URL for <video src> or hls.js. */
  url: string
  /** 'file' = progressive download of the original; 'hls' = m3u8 */
  protocol: 'file' | 'hls'
  mediaIndex: number
  partIndex: number
  media: MediaVersion
  part: MediaPart
  sessionId: string
  /** Text subtitle to render client-side, if any. */
  sidecarSubtitle?: { stream: MediaStream; url: string }
  /** Why direct play was rejected, for the "why is this transcoding" tooltip. */
  reasons: string[]
}

const IMAGE_SUBS = new Set(['pgs', 'hdmv_pgs_subtitle', 'vobsub', 'dvd_subtitle', 'dvb_subtitle'])

export function isImageSubtitle(s: MediaStream): boolean {
  return IMAGE_SUBS.has((s.codec ?? s.format ?? '').toLowerCase())
}

export function pickDefaultMedia(item: Item): number {
  // Prefer the version with the highest resolution that has parts.
  let best = 0
  let bestHeight = -1
  item.media.forEach((m, i) => {
    if (m.parts.length === 0) return
    const h = m.height ?? 0
    if (h > bestHeight) {
      bestHeight = h
      best = i
    }
  })
  return best
}

export function selectedStream(
  part: MediaPart,
  kind: MediaStream['kind'],
): MediaStream | undefined {
  const of = part.streams.filter((s) => s.kind === kind)
  return (
    of.find((s) => s.selected) ??
    of.find((s) => s.default) ??
    (kind === 'subtitle' ? undefined : of[0])
  )
}

/** Decide, purely from metadata, whether the local player can direct play this part. */
export function canDirectPlay(
  media: MediaVersion,
  part: MediaPart,
  caps: PlayerCapabilities,
  prefs: PlaybackPrefs,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const container = (part.container ?? media.container ?? '').toLowerCase()
  if (!caps.containers.includes(container))
    reasons.push(`container ${container || 'unknown'} not supported`)

  const video = selectedStream(part, 'video')
  const vcodec = (video?.codec ?? media.videoCodec ?? '').toLowerCase()
  if (!caps.videoCodecs.includes(vcodec))
    reasons.push(`video codec ${vcodec || 'unknown'} not supported`)
  if (video?.hdr && caps.hdr === false) reasons.push(`HDR (${video.hdr}) not supported`)
  if (caps.maxHeight && (media.height ?? 0) > caps.maxHeight)
    reasons.push(`resolution ${media.height}p exceeds ${caps.maxHeight}p`)

  const audio = prefs.audioStreamId
    ? part.streams.find((s) => s.id === prefs.audioStreamId)
    : selectedStream(part, 'audio')
  const acodec = (audio?.codec ?? media.audioCodec ?? '').toLowerCase()
  if (!caps.audioCodecs.includes(acodec))
    reasons.push(`audio codec ${acodec || 'unknown'} not supported`)

  const bitrateCap = prefs.maxBitrateKbps ?? caps.maxBitrateKbps
  if (bitrateCap && (media.bitrate ?? 0) > bitrateCap)
    reasons.push(`bitrate ${media.bitrate} kbps exceeds ${bitrateCap} kbps`)

  if (prefs.subtitleStreamId) {
    const sub = part.streams.find((s) => s.id === prefs.subtitleStreamId)
    if (sub && isImageSubtitle(sub)) reasons.push(`image subtitle ${sub.codec ?? ''} needs burn-in`)
    else if (
      sub &&
      !sub.external &&
      !caps.subtitleFormats.includes((sub.codec ?? sub.format ?? '').toLowerCase())
    )
      reasons.push(`embedded subtitle ${sub.codec ?? ''} cannot be extracted client-side`)
  }
  return { ok: reasons.length === 0, reasons }
}

export interface PlanInput {
  baseUrl: string
  token: string
  client: PlexClientInfo
  item: Item
  caps: PlayerCapabilities
  prefs?: PlaybackPrefs
  mediaIndex?: number
  partIndex?: number
  sessionId: string
}

/**
 * Build the playback plan: direct play when the player can handle the file, otherwise ask the
 * server for HLS with directStream (copy video, transcode only what is necessary).
 */
export function planPlayback(i: PlanInput): PlaybackPlan {
  const prefs = i.prefs ?? {}
  const mediaIndex = i.mediaIndex ?? pickDefaultMedia(i.item)
  const media = i.item.media[mediaIndex]
  if (!media) throw new Error('Item has no media')
  const partIndex = i.partIndex ?? 0
  const part = media.parts[partIndex]
  if (!part) throw new Error('Media has no parts')

  const q = plexQuery(i.client, i.token)
  const dp = canDirectPlay(media, part, i.caps, prefs)

  let sidecar: PlaybackPlan['sidecarSubtitle']
  const sub = prefs.subtitleStreamId
    ? part.streams.find((s) => s.id === prefs.subtitleStreamId)
    : undefined
  const subNeedsBurn = sub
    ? isImageSubtitle(sub) ||
      (!sub.external && !i.caps.subtitleFormats.includes((sub.codec ?? '').toLowerCase()))
    : false
  if (sub && !subNeedsBurn) {
    sidecar = {
      stream: sub,
      url: buildUrl(i.baseUrl, `library/streams/${sub.id}`, {
        encoding: 'utf-8',
        format: 'webvtt',
        ...q,
      }),
    }
  }

  const base: Omit<PlaybackPlan, 'method' | 'url' | 'protocol' | 'reasons'> = {
    mediaIndex,
    partIndex,
    media,
    part,
    sessionId: i.sessionId,
    ...(sidecar ? { sidecarSubtitle: sidecar } : {}),
  }

  if (dp.ok) {
    return {
      ...base,
      method: 'directplay',
      protocol: 'file',
      url: buildUrl(i.baseUrl, part.key.replace(/^\//, ''), q),
      reasons: [],
    }
  }

  const url = buildUrl(i.baseUrl, 'video/:/transcode/universal/start.m3u8', {
    ...q,
    path: `/library/metadata/${i.item.ratingKey}`,
    mediaIndex,
    partIndex,
    protocol: 'hls',
    fastSeek: 1,
    directPlay: 0,
    directStream: 1,
    directStreamAudio: 1,
    subtitleSize: 100,
    audioBoost: 100,
    location: prefs.location ?? 'lan',
    autoAdjustQuality: 0,
    mediaBufferSize: 102400,
    hasMDE: 1,
    session: i.sessionId,
    subtitles: subNeedsBurn ? 'burn' : 'none',
    ...(prefs.audioStreamId ? { audioStreamID: prefs.audioStreamId } : {}),
    ...(subNeedsBurn && prefs.subtitleStreamId ? { subtitleStreamID: prefs.subtitleStreamId } : {}),
    ...(prefs.maxBitrateKbps ? { maxVideoBitrate: prefs.maxBitrateKbps, videoQuality: 100 } : {}),
    ...(prefs.startMs ? { offset: Math.floor(prefs.startMs / 1000) } : {}),
    'X-Plex-Client-Profile-Extra': profileExtra(i.caps),
  })
  // Whether the server copies or transcodes video is its call; we label it "directstream" when
  // the video codec is supported (server should copy) and "transcode" otherwise.
  const vcodec = (selectedStream(part, 'video')?.codec ?? media.videoCodec ?? '').toLowerCase()
  const method: PlayMethod =
    i.caps.videoCodecs.includes(vcodec) && !subNeedsBurn ? 'directstream' : 'transcode'
  return { ...base, method, protocol: 'hls', url, reasons: dp.reasons }
}

/** Original file download URL (works without Plex Pass, unlike the official mobile apps). */
export function downloadUrl(
  baseUrl: string,
  token: string,
  client: PlexClientInfo,
  part: MediaPart,
): string {
  return buildUrl(baseUrl, part.key.replace(/^\//, ''), {
    download: 1,
    ...plexQuery(client, token),
  })
}

/**
 * Tell the transcoder what the player accepts so "directStream" copies video instead of re-encoding.
 * Plex's profile mini-language: statements joined by '+'.
 */
export function profileExtra(caps: PlayerCapabilities): string {
  const video = caps.videoCodecs.join(',')
  const audio = caps.audioCodecs.join(',')
  const parts = [
    `add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=${video}&audioCodec=${audio}&subtitleCodec=&replace=true)`,
    `add-transcode-target-audio-codec(type=videoProfile&context=streaming&protocol=hls&audioCodec=${audio})`,
  ]
  if (caps.hdr === false) {
    parts.push(
      'add-limitation(scope=videoCodec&scopeName=*&type=upperBound&name=video.bitDepth&value=8&replace=true)',
    )
  }
  if (caps.maxHeight) {
    parts.push(
      `add-limitation(scope=videoCodec&scopeName=*&type=upperBound&name=video.height&value=${caps.maxHeight}&replace=true)`,
    )
  }
  return parts.join('+')
}
