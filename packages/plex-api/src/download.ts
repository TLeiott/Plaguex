import { plexQuery, type PlexClientInfo } from './headers'
import { buildUrl } from './http'
import type { Item, MediaVersion } from './types'

/** Quality ladder for transcoded downloads. Bitrates match Plex's own quality presets. */
export interface DownloadPreset {
  id: string
  label: string
  height: number
  width: number
  kbps: number
}

export const DOWNLOAD_PRESETS: readonly DownloadPreset[] = [
  { id: '2160p-20', label: '4K · 20 Mbps', height: 2160, width: 3840, kbps: 20000 },
  { id: '1440p-12', label: '1440p · 12 Mbps', height: 1440, width: 2560, kbps: 12000 },
  { id: '1080p-8', label: '1080p · 8 Mbps', height: 1080, width: 1920, kbps: 8000 },
  { id: '1080p-4', label: '1080p · 4 Mbps', height: 1080, width: 1920, kbps: 4000 },
  { id: '720p-2', label: '720p · 2 Mbps', height: 720, width: 1280, kbps: 2000 },
  { id: '480p-1', label: '480p · 1 Mbps', height: 480, width: 720, kbps: 1000 },
]

/** What to download: the original file of a media version, or a transcode at a preset. */
export type DownloadChoice =
  { kind: 'original'; mediaIndex: number } | { kind: 'transcode'; preset: DownloadPreset }

/** Presets that make sense for this media (never upscale above the source). */
export function presetsFor(media: MediaVersion | undefined): DownloadPreset[] {
  const h = media?.height ?? Infinity
  const list = DOWNLOAD_PRESETS.filter((p) => p.height <= h)
  return list.length > 0 ? list : [DOWNLOAD_PRESETS[DOWNLOAD_PRESETS.length - 1]!]
}

/** Estimated size of a transcode: video bitrate + ~128 kbps stereo audio over the runtime. */
export function estimateTranscodeBytes(
  durationMs: number | undefined,
  preset: DownloadPreset,
): number | null {
  if (!durationMs) return null
  return Math.round(((preset.kbps + 128) * 1000 * (durationMs / 1000)) / 8)
}

/** Size of the original file for a choice, or the estimate for a transcode. */
export function estimateDownloadBytes(item: Item, choice: DownloadChoice): number | null {
  if (choice.kind === 'original') {
    const part = item.media[choice.mediaIndex]?.parts[0]
    return part?.size ?? null
  }
  return estimateTranscodeBytes(item.durationMs, choice.preset)
}

/**
 * Progressive (non-HLS) transcode URL. The server re-encodes to H.264/AAC at the preset's
 * resolution and bitrate and streams the file; there is no Content-Length, so downloads of this
 * URL cannot be resumed and restart from zero instead.
 */
export function transcodeDownloadUrl(o: {
  baseUrl: string
  token: string
  client: PlexClientInfo
  item: Item
  mediaIndex: number
  preset: DownloadPreset
  sessionId: string
  /** Output container; PMS 1.43 was observed to return Matroska regardless. */
  container?: 'mp4' | 'mkv'
}): string {
  const container = o.container ?? 'mp4'
  const profile = `add-transcode-target(type=videoProfile&context=streaming&protocol=http&container=${container}&videoCodec=h264&audioCodec=aac&replace=true)`
  return buildUrl(o.baseUrl, `video/:/transcode/universal/start.${container}`, {
    ...plexQuery(o.client, o.token),
    path: `/library/metadata/${o.item.ratingKey}`,
    mediaIndex: o.mediaIndex,
    partIndex: 0,
    protocol: 'http',
    container,
    videoCodec: 'h264',
    audioCodec: 'aac',
    videoResolution: `${o.preset.width}x${o.preset.height}`,
    maxVideoBitrate: o.preset.kbps,
    videoQuality: 100,
    directPlay: 0,
    directStream: 0,
    subtitles: 'none',
    hasMDE: 1,
    session: o.sessionId,
    'X-Plex-Client-Profile-Extra': profile,
  })
}
