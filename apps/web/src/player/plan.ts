import {
  planPlayback,
  selectedStream,
  type Item,
  type PlaybackPlan,
  type PlayerCapabilities,
} from '@plaguex/plex-api'
import { useSession } from '@/plex/session'
import { buildClientInfo } from '@/plex/client-info'

export interface TrackChoice {
  audioStreamId?: number
  /** 0 = off */
  subtitleStreamId?: number
}

export function newSessionId(): string {
  return crypto.randomUUID()
}

/** Initial track choice: what Plex has selected server-side, honouring the "subtitles on by default" setting. */
export function defaultTracks(item: Item, mediaIndex: number): TrackChoice {
  const part = item.media[mediaIndex]?.parts[0]
  if (!part) return {}
  const { settings } = useSession.getState()
  const out: TrackChoice = {}
  const audio = selectedStream(part, 'audio')
  if (audio) out.audioStreamId = audio.id
  const sub = selectedStream(part, 'subtitle')
  if (sub && (sub.selected || settings.subtitlesOnByDefault)) out.subtitleStreamId = sub.id
  else out.subtitleStreamId = 0
  return out
}

export function buildPlan(o: {
  item: Item
  caps: PlayerCapabilities
  tracks: TrackChoice
  startMs: number
  sessionId: string
  /** Force the transcoder path (used after a direct-play failure). */
  forceTranscode?: boolean
  mediaIndex?: number
}): PlaybackPlan {
  const { activeServer, clientIdentifier, settings } = useSession.getState()
  if (!activeServer) throw new Error('No active server')
  const base: PlayerCapabilities = o.forceTranscode
    ? { ...o.caps, containers: [], videoCodecs: o.caps.videoCodecs }
    : o.caps
  // User cap on resolution (e.g. 1440p on a phone): sources above it go through the transcoder.
  const capHeight = settings.maxHeight
  const caps: PlayerCapabilities = capHeight
    ? { ...base, maxHeight: Math.min(base.maxHeight ?? Infinity, capHeight) }
    : base
  const isLocal =
    /^(https?:\/\/)?(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      activeServer.baseUrl,
    ) || activeServer.baseUrl.includes('.plex.direct')
  return planPlayback({
    baseUrl: activeServer.baseUrl,
    token: activeServer.token,
    client: buildClientInfo(clientIdentifier),
    item: o.item,
    caps,
    sessionId: o.sessionId,
    ...(o.mediaIndex !== undefined ? { mediaIndex: o.mediaIndex } : {}),
    prefs: {
      startMs: o.startMs,
      location: isLocal ? 'lan' : 'wan',
      ...(settings.maxBitrateKbps ? { maxBitrateKbps: settings.maxBitrateKbps } : {}),
      ...(o.tracks.audioStreamId ? { audioStreamId: o.tracks.audioStreamId } : {}),
      ...(o.tracks.subtitleStreamId ? { subtitleStreamId: o.tracks.subtitleStreamId } : {}),
    },
  })
}
