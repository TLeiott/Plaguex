/** Normalized domain model used by the UI. Independent of Plex wire quirks. */

export type LibraryType = 'movie' | 'show' | 'artist' | 'photo' | 'unknown'

export interface Library {
  id: string
  title: string
  type: LibraryType
  uuid?: string
  /** Relative image path, resolve with PlexServer.imageUrl */
  thumb?: string
  art?: string
}

export type ItemType = 'movie' | 'show' | 'season' | 'episode' | 'clip' | 'unknown'

export interface Tag {
  id?: number
  tag: string
  role?: string
  thumb?: string
}

export interface Marker {
  /** 'intro' | 'credits' | 'commercial' or any future Plex marker type */
  type: string
  startMs: number
  endMs: number
  final: boolean
}

export interface Chapter {
  index: number
  title?: string
  startMs: number
  endMs: number
  thumb?: string
}

export type StreamKind = 'video' | 'audio' | 'subtitle' | 'lyrics'

export interface MediaStream {
  id: number
  kind: StreamKind
  codec?: string
  index?: number
  language?: string
  languageCode?: string
  title?: string
  displayTitle: string
  selected: boolean
  default: boolean
  forced: boolean
  /** Subtitles stored outside the container (sidecar file). */
  external: boolean
  /** Path for external subtitle download, e.g. /library/streams/123 */
  key?: string
  format?: string
  width?: number
  height?: number
  frameRate?: number
  profile?: string
  bitDepth?: number
  channels?: number
  channelLayout?: string
  bitrate?: number
  hdr?: 'hdr10' | 'hlg' | 'dolby-vision' | undefined
}

export interface MediaPart {
  id: number
  /** Direct file path on the server, e.g. /library/parts/1/1234/file.mkv */
  key: string
  file?: string
  size?: number
  durationMs?: number
  container?: string
  streams: MediaStream[]
}

export interface MediaVersion {
  id: number
  durationMs?: number
  bitrate?: number
  width?: number
  height?: number
  videoResolution?: string
  videoCodec?: string
  audioCodec?: string
  audioChannels?: number
  container?: string
  videoProfile?: string
  parts: MediaPart[]
}

export interface Item {
  ratingKey: string
  key: string
  type: ItemType
  title: string
  sortTitle?: string
  originalTitle?: string
  summary?: string
  tagline?: string
  year?: number
  /** ISO date YYYY-MM-DD */
  releaseDate?: string
  index?: number
  parentIndex?: number
  parentRatingKey?: string
  parentTitle?: string
  parentThumb?: string
  grandparentRatingKey?: string
  grandparentTitle?: string
  grandparentThumb?: string
  grandparentArt?: string
  libraryId?: string
  libraryTitle?: string
  thumb?: string
  art?: string
  durationMs?: number
  viewOffsetMs?: number
  viewCount: number
  /** Unix seconds */
  lastViewedAt?: number
  addedAt?: number
  updatedAt?: number
  contentRating?: string
  rating?: number
  audienceRating?: number
  userRating?: number
  studio?: string
  leafCount?: number
  viewedLeafCount?: number
  childCount?: number
  media: MediaVersion[]
  genres: Tag[]
  directors: Tag[]
  writers: Tag[]
  roles: Tag[]
  markers: Marker[]
  chapters: Chapter[]
}

export interface Hub {
  key?: string
  identifier: string
  title: string
  type: string
  more: boolean
  items: Item[]
}

export interface Page<T> {
  items: T[]
  offset: number
  total: number
}

export interface ServerInfo {
  machineIdentifier: string
  friendlyName: string
  version: string
  platform?: string
  transcoderVideo: boolean
  transcoderAudio: boolean
  transcoderSubtitles: boolean
}

export interface PlexUser {
  id: number
  uuid: string
  username: string
  title: string
  email?: string
  thumb?: string
  plexPass: boolean
}

export interface ServerConnection {
  uri: string
  protocol: 'http' | 'https'
  address: string
  port: number
  local: boolean
  relay: boolean
}

export interface ServerResource {
  name: string
  clientIdentifier: string
  product: string
  productVersion: string
  platform?: string
  owned: boolean
  /** Token to talk to this server, may differ from account token for shared servers. */
  accessToken: string | null
  presence: boolean
  httpsRequired: boolean
  connections: ServerConnection[]
}

export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'buffering'
