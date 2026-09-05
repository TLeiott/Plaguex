import type {
  RawDirectory,
  RawHub,
  RawMedia,
  RawMetadata,
  RawPart,
  RawResource,
  RawStream,
  RawTag,
  RawPlexUser,
} from './raw'
import type {
  Hub,
  Item,
  ItemType,
  Library,
  LibraryType,
  Marker,
  MediaPart,
  MediaStream,
  MediaVersion,
  PlexUser,
  ServerResource,
  StreamKind,
  Tag,
} from './types'

const LIBRARY_TYPES: readonly LibraryType[] = ['movie', 'show', 'artist', 'photo']
const ITEM_TYPES: readonly ItemType[] = ['movie', 'show', 'season', 'episode', 'clip']

export function normalizeLibrary(d: RawDirectory): Library {
  const type = LIBRARY_TYPES.includes(d.type as LibraryType) ? (d.type as LibraryType) : 'unknown'
  const lib: Library = { id: d.key, title: d.title, type }
  if (d.uuid) lib.uuid = d.uuid
  if (d.thumb) lib.thumb = d.thumb
  if (d.art) lib.art = d.art
  return lib
}

const streamKind = (t: RawStream['streamType']): StreamKind =>
  t === 1 ? 'video' : t === 2 ? 'audio' : t === 3 ? 'subtitle' : 'lyrics'

function detectHdr(s: RawStream): MediaStream['hdr'] {
  if (s.DOVIPresent) return 'dolby-vision'
  if (s.colorTrc === 'smpte2084') return 'hdr10'
  if (s.colorTrc === 'arib-std-b67') return 'hlg'
  return undefined
}

export function normalizeStream(s: RawStream): MediaStream {
  const out: MediaStream = {
    id: s.id,
    kind: streamKind(s.streamType),
    displayTitle:
      s.extendedDisplayTitle ?? s.displayTitle ?? s.title ?? s.language ?? `Stream ${s.id}`,
    selected: Boolean(s.selected),
    default: Boolean(s.default),
    forced: Boolean(s.forced),
    external: Boolean(s.key),
  }
  if (s.codec) out.codec = s.codec
  if (s.index !== undefined) out.index = s.index
  if (s.language) out.language = s.language
  if (s.languageCode) out.languageCode = s.languageCode
  if (s.title) out.title = s.title
  if (s.key) out.key = s.key
  if (s.format) out.format = s.format
  if (s.width) out.width = s.width
  if (s.height) out.height = s.height
  if (s.frameRate) out.frameRate = s.frameRate
  if (s.profile) out.profile = s.profile
  if (s.bitDepth) out.bitDepth = s.bitDepth
  if (s.channels) out.channels = s.channels
  if (s.audioChannelLayout) out.channelLayout = s.audioChannelLayout
  if (s.bitrate) out.bitrate = s.bitrate
  const hdr = detectHdr(s)
  if (hdr) out.hdr = hdr
  return out
}

export function normalizePart(p: RawPart): MediaPart {
  const out: MediaPart = { id: p.id, key: p.key, streams: (p.Stream ?? []).map(normalizeStream) }
  if (p.file) out.file = p.file
  if (p.size !== undefined) out.size = p.size
  if (p.duration !== undefined) out.durationMs = p.duration
  if (p.container) out.container = p.container
  return out
}

export function normalizeMedia(m: RawMedia): MediaVersion {
  const out: MediaVersion = { id: m.id, parts: (m.Part ?? []).map(normalizePart) }
  if (m.duration !== undefined) out.durationMs = m.duration
  if (m.bitrate !== undefined) out.bitrate = m.bitrate
  if (m.width !== undefined) out.width = m.width
  if (m.height !== undefined) out.height = m.height
  if (m.videoResolution) out.videoResolution = m.videoResolution
  if (m.videoCodec) out.videoCodec = m.videoCodec
  if (m.audioCodec) out.audioCodec = m.audioCodec
  if (m.audioChannels !== undefined) out.audioChannels = m.audioChannels
  if (m.container) out.container = m.container
  if (m.videoProfile) out.videoProfile = m.videoProfile
  return out
}

const tag = (t: RawTag): Tag => {
  const out: Tag = { tag: t.tag }
  if (t.id !== undefined) out.id = t.id
  if (t.role) out.role = t.role
  if (t.thumb) out.thumb = t.thumb
  return out
}

export function normalizeItem(m: RawMetadata): Item {
  const type = ITEM_TYPES.includes(m.type as ItemType) ? (m.type as ItemType) : 'unknown'
  const item: Item = {
    ratingKey: m.ratingKey,
    key: m.key,
    type,
    title: m.title,
    viewCount: m.viewCount ?? 0,
    media: (m.Media ?? []).map(normalizeMedia),
    genres: (m.Genre ?? []).map(tag),
    directors: (m.Director ?? []).map(tag),
    writers: (m.Writer ?? []).map(tag),
    roles: (m.Role ?? []).map(tag),
    markers: (m.Marker ?? []).map((mk): Marker => ({
      type: mk.type,
      startMs: mk.startTimeOffset,
      endMs: mk.endTimeOffset,
      final: Boolean(mk.final),
    })),
    chapters: (m.Chapter ?? []).map((c) => {
      const ch: Item['chapters'][number] = {
        index: c.index,
        startMs: c.startTimeOffset,
        endMs: c.endTimeOffset,
      }
      if (c.tag) ch.title = c.tag
      if (c.thumb) ch.thumb = c.thumb
      return ch
    }),
  }
  const opt = <K extends keyof Item>(k: K, v: Item[K] | undefined | null) => {
    if (v !== undefined && v !== null && v !== '') (item as Record<K, Item[K]>)[k] = v
  }
  opt('sortTitle', m.titleSort)
  opt('originalTitle', m.originalTitle)
  opt('summary', m.summary)
  opt('tagline', m.tagline)
  opt('year', m.year)
  opt('releaseDate', m.originallyAvailableAt)
  opt('index', m.index)
  opt('parentIndex', m.parentIndex)
  opt('parentRatingKey', m.parentRatingKey)
  opt('parentTitle', m.parentTitle)
  opt('parentThumb', m.parentThumb)
  opt('grandparentRatingKey', m.grandparentRatingKey)
  opt('grandparentTitle', m.grandparentTitle)
  opt('grandparentThumb', m.grandparentThumb)
  opt('grandparentArt', m.grandparentArt)
  opt('libraryId', m.librarySectionID !== undefined ? String(m.librarySectionID) : undefined)
  opt('libraryTitle', m.librarySectionTitle)
  opt('thumb', m.thumb)
  opt('art', m.art)
  opt('durationMs', m.duration)
  opt('viewOffsetMs', m.viewOffset)
  opt('lastViewedAt', m.lastViewedAt)
  opt('addedAt', m.addedAt)
  opt('updatedAt', m.updatedAt)
  opt('contentRating', m.contentRating)
  opt('rating', m.rating)
  opt('audienceRating', m.audienceRating)
  opt('userRating', m.userRating)
  opt('studio', m.studio)
  opt('leafCount', m.leafCount)
  opt('viewedLeafCount', m.viewedLeafCount)
  opt('childCount', m.childCount)
  return item
}

export function normalizeHub(h: RawHub): Hub {
  const hub: Hub = {
    identifier: h.hubIdentifier,
    title: h.title,
    type: h.type,
    more: Boolean(h.more),
    items: (h.Metadata ?? []).map(normalizeItem),
  }
  const key = h.hubKey ?? h.key
  if (key) hub.key = key
  return hub
}

export function normalizeResource(r: RawResource): ServerResource {
  const out: ServerResource = {
    name: r.name,
    clientIdentifier: r.clientIdentifier,
    product: r.product,
    productVersion: r.productVersion,
    owned: r.owned,
    accessToken: r.accessToken,
    presence: r.presence,
    httpsRequired: r.httpsRequired,
    connections: r.connections.map((c) => ({
      uri: c.uri,
      protocol: c.protocol,
      address: c.address,
      port: c.port,
      local: c.local,
      relay: c.relay,
    })),
  }
  if (r.platform) out.platform = r.platform
  return out
}

export function normalizeUser(u: RawPlexUser): PlexUser {
  const out: PlexUser = {
    id: u.id,
    uuid: u.uuid,
    username: u.username,
    title: u.title,
    plexPass: Boolean(u.subscription?.active),
  }
  if (u.email) out.email = u.email
  if (u.thumb) out.thumb = u.thumb
  return out
}
