/**
 * Raw wire shapes returned by Plex Media Server with Accept: application/json.
 * Only the fields Plaguex reads are typed. Everything is optional because PMS omits absent values.
 */
export interface RawContainer<T> {
  MediaContainer: T
}

export interface RawServerIdentity {
  machineIdentifier?: string
  version?: string
  friendlyName?: string
  platform?: string
  transcoderVideo?: boolean
  transcoderAudio?: boolean
  transcoderSubtitles?: boolean
  myPlex?: boolean
  myPlexUsername?: string
  Directory?: RawDirectory[]
}

export interface RawDirectory {
  key: string
  title: string
  type?: string
  uuid?: string
  agent?: string
  scanner?: string
  language?: string
  thumb?: string
  art?: string
  composite?: string
  updatedAt?: number
  scannedAt?: number
  hubKey?: string
  refreshing?: boolean
  Location?: { id: number; path: string }[]
}

export interface RawSectionsContainer {
  size: number
  Directory?: RawDirectory[]
}

export interface RawMetadataContainer {
  size: number
  totalSize?: number
  offset?: number
  librarySectionID?: number
  librarySectionTitle?: string
  Metadata?: RawMetadata[]
  Directory?: RawDirectory[]
  Hub?: RawHub[]
}

export interface RawHub {
  hubKey?: string
  key?: string
  title: string
  type: string
  hubIdentifier: string
  size: number
  more?: boolean
  style?: string
  Metadata?: RawMetadata[]
}

export interface RawTag {
  id?: number
  tag: string
  filter?: string
  role?: string
  thumb?: string
}

export interface RawMarker {
  id?: number
  type: string
  startTimeOffset: number
  endTimeOffset: number
  final?: boolean
}

export interface RawChapter {
  id?: number
  index: number
  startTimeOffset: number
  endTimeOffset: number
  tag?: string
  thumb?: string
}

export interface RawStream {
  id: number
  streamType: 1 | 2 | 3 | 4
  default?: boolean
  selected?: boolean
  forced?: boolean
  codec?: string
  index?: number
  bitrate?: number
  language?: string
  languageTag?: string
  languageCode?: string
  title?: string
  displayTitle?: string
  extendedDisplayTitle?: string
  /** Set for external subtitle files; fetch via /library/streams/{id} */
  key?: string
  format?: string
  /** video */
  width?: number
  height?: number
  frameRate?: number
  profile?: string
  level?: number
  bitDepth?: number
  colorPrimaries?: string
  colorTrc?: string
  DOVIPresent?: boolean
  /** audio */
  channels?: number
  audioChannelLayout?: string
  samplingRate?: number
  /** subtitle */
  embedded?: boolean
  hearingImpaired?: boolean
}

export interface RawPart {
  id: number
  key: string
  duration?: number
  file?: string
  size?: number
  container?: string
  indexes?: string
  videoProfile?: string
  audioProfile?: string
  has64bitOffsets?: boolean
  optimizedForStreaming?: boolean
  Stream?: RawStream[]
}

export interface RawMedia {
  id: number
  duration?: number
  bitrate?: number
  width?: number
  height?: number
  aspectRatio?: number
  audioChannels?: number
  audioCodec?: string
  videoCodec?: string
  videoResolution?: string
  container?: string
  videoFrameRate?: string
  videoProfile?: string
  audioProfile?: string
  optimizedForStreaming?: boolean | number
  has64bitOffsets?: boolean
  Part?: RawPart[]
}

export interface RawMetadata {
  ratingKey: string
  key: string
  guid?: string
  type: string
  title: string
  titleSort?: string
  originalTitle?: string
  summary?: string
  tagline?: string
  year?: number
  originallyAvailableAt?: string
  index?: number
  parentIndex?: number
  parentRatingKey?: string
  parentKey?: string
  parentTitle?: string
  parentThumb?: string
  grandparentRatingKey?: string
  grandparentKey?: string
  grandparentTitle?: string
  grandparentThumb?: string
  grandparentArt?: string
  grandparentTheme?: string
  librarySectionID?: number
  librarySectionTitle?: string
  librarySectionKey?: string
  thumb?: string
  art?: string
  banner?: string
  theme?: string
  duration?: number
  viewOffset?: number
  viewCount?: number
  skipCount?: number
  lastViewedAt?: number
  addedAt?: number
  updatedAt?: number
  contentRating?: string
  rating?: number
  audienceRating?: number
  userRating?: number
  ratingImage?: string
  audienceRatingImage?: string
  studio?: string
  leafCount?: number
  viewedLeafCount?: number
  childCount?: number
  Media?: RawMedia[]
  Genre?: RawTag[]
  Director?: RawTag[]
  Writer?: RawTag[]
  Role?: RawTag[]
  Country?: RawTag[]
  Marker?: RawMarker[]
  Chapter?: RawChapter[]
  Collection?: RawTag[]
  /** Present when requested with includeOnDeck=1 on a show/season. */
  OnDeck?: { Metadata?: RawMetadata }
}

/** plex.tv/api/v2 */
export interface RawPin {
  id: number
  code: string
  expiresIn: number
  createdAt: string
  expiresAt: string
  authToken: string | null
  clientIdentifier: string
  trusted?: boolean
}

export interface RawPlexUser {
  id: number
  uuid: string
  username: string
  title: string
  email?: string
  thumb?: string
  authToken?: string
  hasPassword?: boolean
  subscription?: { active?: boolean; status?: string }
}

export interface RawConnection {
  protocol: 'http' | 'https'
  address: string
  port: number
  uri: string
  local: boolean
  relay: boolean
  IPv6: boolean
}

export interface RawResource {
  name: string
  product: string
  productVersion: string
  platform: string | null
  platformVersion?: string | null
  device?: string | null
  clientIdentifier: string
  createdAt: string
  lastSeenAt: string
  provides: string
  owned: boolean
  ownerId?: number | null
  sourceTitle?: string | null
  accessToken: string | null
  publicAddress?: string
  httpsRequired: boolean
  presence: boolean
  connections: RawConnection[]
}
