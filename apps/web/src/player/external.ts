import { buildUrl, plexQuery, type Item, type MediaPart, type MediaStream } from '@plaguex/plex-api'
import type { ExternalPlayRequest } from '@/platform'
import { useSession } from '@/plex/session'
import { buildClientInfo } from '@/plex/client-info'
import { episodeCode } from '@/lib/format'

/**
 * mpv addresses tracks by 1-based ordinal within their type (audio #1, #2, ...), which matches the
 * order Plex lists streams of that kind in the part. External subtitle files are not counted here
 * because mpv appends them after the embedded ones.
 */
export function trackOrdinal(part: MediaPart, streamId: number): number | undefined {
  const target = part.streams.find((s) => s.id === streamId)
  if (!target || target.kind === 'video') return undefined
  const sameKind = part.streams.filter((s) => s.kind === target.kind && !s.external)
  const idx = sameKind.findIndex((s) => s.id === streamId)
  return idx >= 0 ? idx + 1 : undefined
}

/** Ordinal of an external subtitle among mpv's --sub-file list, offset by embedded subtitle count. */
export function externalSubtitleOrdinal(part: MediaPart, streamId: number): number | undefined {
  const embedded = part.streams.filter((s) => s.kind === 'subtitle' && !s.external).length
  const externals = part.streams.filter((s) => s.kind === 'subtitle' && s.external)
  const idx = externals.findIndex((s) => s.id === streamId)
  return idx >= 0 ? embedded + idx + 1 : undefined
}

export function externalSubtitleUrls(
  baseUrl: string,
  token: string,
  part: MediaPart,
  client: ReturnType<typeof buildClientInfo>,
): string[] {
  return part.streams
    .filter((s): s is MediaStream & { external: true } => s.kind === 'subtitle' && s.external)
    .map((s) =>
      buildUrl(baseUrl, `library/streams/${s.id}`, {
        encoding: 'utf-8',
        ...plexQuery(client, token),
      }),
    )
}

export function buildExternalRequest(o: {
  item: Item
  mediaIndex: number
  startMs: number
  audioStreamId?: number
  subtitleStreamId?: number
}): ExternalPlayRequest {
  const { activeServer, clientIdentifier } = useSession.getState()
  if (!activeServer) throw new Error('No active server')
  const client = buildClientInfo(clientIdentifier)
  const media = o.item.media[o.mediaIndex]
  const part = media?.parts[0]
  if (!part) throw new Error('Item has no media part')
  const url = buildUrl(
    activeServer.baseUrl,
    part.key.replace(/^\//, ''),
    plexQuery(client, activeServer.token),
  )
  const title =
    o.item.type === 'episode'
      ? `${o.item.grandparentTitle ?? ''} ${episodeCode(o.item.parentIndex, o.item.index)} · ${o.item.title}`.trim()
      : o.item.year
        ? `${o.item.title} (${o.item.year})`
        : o.item.title

  const req: ExternalPlayRequest = {
    url,
    title,
    startSecs: o.startMs / 1000,
    subtitleFiles: externalSubtitleUrls(activeServer.baseUrl, activeServer.token, part, client),
    httpHeaders: [
      `X-Plex-Token: ${activeServer.token}`,
      `X-Plex-Client-Identifier: ${clientIdentifier}`,
    ],
    fullscreen: true,
  }
  if (o.audioStreamId) {
    const a = trackOrdinal(part, o.audioStreamId)
    if (a) req.audioTrack = a
  }
  if (o.subtitleStreamId === 0) req.subtitleTrack = 0
  else if (o.subtitleStreamId) {
    const sub = part.streams.find((s) => s.id === o.subtitleStreamId)
    const s = sub?.external
      ? externalSubtitleOrdinal(part, o.subtitleStreamId)
      : trackOrdinal(part, o.subtitleStreamId)
    if (s) req.subtitleTrack = s
  }
  return req
}
