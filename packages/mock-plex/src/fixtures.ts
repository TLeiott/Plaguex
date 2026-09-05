export interface Stream {
  id: number
  streamType: 1 | 2 | 3
  codec: string
  displayTitle: string
  extendedDisplayTitle: string
  selected?: boolean
  default?: boolean
  language?: string
  languageCode?: string
  key?: string
  channels?: number
  audioChannelLayout?: string
  width?: number
  height?: number
  frameRate?: number
  profile?: string
  bitDepth?: number
  colorTrc?: string
}

export interface Part {
  id: number
  key: string
  file: string
  size: number
  container: string
  duration: number
  Stream: Stream[]
}

export interface Media {
  id: number
  duration: number
  bitrate: number
  width: number
  height: number
  videoResolution: string
  videoCodec: string
  audioCodec: string
  audioChannels: number
  container: string
  videoProfile: string
  Part: Part[]
}

export interface Metadata {
  ratingKey: string
  key: string
  type: 'movie' | 'show' | 'season' | 'episode'
  title: string
  titleSort?: string
  summary?: string
  tagline?: string
  year?: number
  parentIndex?: number
  index?: number
  parentRatingKey?: string
  parentTitle?: string
  parentThumb?: string
  grandparentRatingKey?: string
  grandparentTitle?: string
  grandparentThumb?: string
  grandparentArt?: string
  librarySectionID: number
  librarySectionTitle: string
  thumb: string
  art: string
  duration?: number
  addedAt: number
  lastViewedAt?: number
  viewOffset?: number
  viewCount?: number
  contentRating?: string
  rating?: number
  audienceRating?: number
  studio?: string
  leafCount?: number
  viewedLeafCount?: number
  childCount?: number
  Media?: Media[]
  Genre?: { tag: string }[]
  Director?: { tag: string }[]
  Role?: { tag: string; role: string }[]
  Marker?: { type: string; startTimeOffset: number; endTimeOffset: number; final?: boolean }[]
  Chapter?: { index: number; startTimeOffset: number; endTimeOffset: number; tag?: string }[]
  OnDeck?: { Metadata?: Metadata }
}

export interface Library {
  key: string
  title: string
  type: 'movie' | 'show' | 'artist'
  uuid: string
}

export interface TimelineEvent {
  ratingKey: string
  state: string
  time: number
  duration: number
}

export interface Fixtures {
  libraries: Library[]
  movies: Metadata[]
  shows: Metadata[]
  seasons: Metadata[]
  episodes: Metadata[]
  byRatingKey: Map<string, Metadata>
  timelineEvents: TimelineEvent[]
  scrobbles: string[]
  streamSelections: Record<string, { audioStreamID?: number; subtitleStreamID?: number }>
  transcodeSessions: Set<string>
}

const tags = (values: string[]) => values.map((tag) => ({ tag }))

function media(
  id: number,
  kind: 'mp4' | 'hevc' | 'subs' | 'episode' = 'mp4',
  height = 1080,
): Media {
  const container = kind === 'mp4' ? 'mp4' : 'mkv'
  const videoCodec = kind === 'hevc' ? 'hevc' : 'h264'
  const audioCodec = kind === 'subs' ? 'dts' : kind === 'hevc' ? 'eac3' : 'aac'
  const partId = 10_000 + id
  const streams: Stream[] = [
    {
      id: 20_000 + id * 10,
      streamType: 1,
      codec: videoCodec,
      displayTitle: `${height}p (${videoCodec.toUpperCase()})`,
      extendedDisplayTitle: `${height}p (${videoCodec.toUpperCase()} Main)`,
      selected: true,
      default: true,
      width: height === 2160 ? 3840 : height === 720 ? 1280 : 1920,
      height,
      frameRate: 23.976,
      profile: kind === 'hevc' ? 'main 10' : 'baseline',
      ...(kind === 'hevc' ? { bitDepth: 10, colorTrc: 'smpte2084' } : {}),
    },
    {
      id: 20_001 + id * 10,
      streamType: 2,
      codec: audioCodec,
      displayTitle: `English (${audioCodec.toUpperCase()} 5.1)`,
      extendedDisplayTitle: `English (${audioCodec.toUpperCase()} 5.1)`,
      selected: true,
      default: true,
      language: 'English',
      languageCode: 'eng',
      channels: kind === 'mp4' || kind === 'episode' ? 2 : 6,
      audioChannelLayout: kind === 'mp4' || kind === 'episode' ? 'stereo' : '5.1',
    },
  ]
  if (kind === 'hevc')
    streams.push({
      id: 20_002 + id * 10,
      streamType: 3,
      codec: 'pgs',
      displayTitle: 'English (PGS)',
      extendedDisplayTitle: 'English (PGS)',
      language: 'English',
      languageCode: 'eng',
    })
  if (kind === 'subs') {
    streams.push({
      id: 20_002 + id * 10,
      streamType: 3,
      codec: 'ass',
      displayTitle: 'English (ASS)',
      extendedDisplayTitle: 'English (ASS)',
      language: 'English',
      languageCode: 'eng',
    })
    streams.push({
      id: 20_003 + id * 10,
      streamType: 3,
      codec: 'srt',
      displayTitle: 'Deutsch (SRT External)',
      extendedDisplayTitle: 'Deutsch (SRT External)',
      language: 'Deutsch',
      languageCode: 'deu',
      key: `/library/streams/${20_003 + id * 10}`,
    })
  }
  const duration = 6_000_000 + id * 1000
  return {
    id,
    duration,
    bitrate: kind === 'hevc' ? 28_000 : 8_000,
    width: height === 2160 ? 3840 : height === 720 ? 1280 : 1920,
    height,
    videoResolution: height === 2160 ? '4k' : `${height}`,
    videoCodec,
    audioCodec,
    audioChannels: kind === 'mp4' || kind === 'episode' ? 2 : 6,
    container,
    videoProfile: kind === 'hevc' ? 'main 10' : 'baseline',
    Part: [
      {
        id: partId,
        key: `/library/parts/${partId}/1700000000/file.${container}`,
        file: `/media/Movie ${id}.${container}`,
        size: 300_000,
        container,
        duration,
        Stream: streams,
      },
    ],
  }
}

function movie(index: number): Metadata {
  const ratingKey = String(100 + index)
  const kinds = ['mp4', 'hevc', 'subs'] as const
  const kind = kinds[(index - 1) % kinds.length] ?? 'mp4'
  const Media = [media(index, kind, kind === 'hevc' ? 2160 : 1080)]
  if (index === 4) Media.push(media(100 + index, 'mp4', 720))
  return {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    type: 'movie',
    title: `Movie ${String(index).padStart(2, '0')}`,
    titleSort: `Movie ${String(index).padStart(2, '0')}`,
    summary: `A deterministic summary for movie ${index}.`,
    tagline: `Tagline ${index}`,
    year: 2000 + index,
    librarySectionID: 1,
    librarySectionTitle: 'Movies',
    thumb: `/library/metadata/${ratingKey}/thumb/1`,
    art: `/library/metadata/${ratingKey}/art/1`,
    duration: Media[0]!.duration,
    addedAt: 1_700_000_000 + index * 100,
    ...(index === 5 ? { viewOffset: 1_200_000 } : {}),
    ...(index === 6 || index === 7 ? { viewCount: 1, lastViewedAt: 1_700_001_000 + index } : {}),
    contentRating: index % 2 ? 'PG-13' : 'R',
    rating: 6 + index / 4,
    audienceRating: 7 + index / 5,
    studio: `Studio ${index}`,
    Genre: tags(index % 2 ? ['Drama', 'Adventure'] : ['Comedy']),
    Director: tags([`Director ${index}`]),
    Role: [{ tag: `Actor ${index}`, role: `Character ${index}` }],
    Media,
  }
}

function episode(
  show: Metadata,
  season: Metadata,
  number: number,
  watched: boolean,
  progress: boolean,
): Metadata {
  const ratingKey = String(Number(season.ratingKey) * 10 + number)
  const duration = 2_700_000
  return {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    type: 'episode',
    title: `${show.title} Episode ${number}`,
    parentIndex: season.index!,
    index: number,
    parentRatingKey: season.ratingKey,
    parentTitle: season.title,
    parentThumb: season.thumb,
    grandparentRatingKey: show.ratingKey,
    grandparentTitle: show.title,
    grandparentThumb: show.thumb,
    grandparentArt: show.art,
    librarySectionID: 2,
    librarySectionTitle: 'TV Shows',
    thumb: `/library/metadata/${ratingKey}/thumb/1`,
    art: show.art,
    duration,
    addedAt: 1_700_100_000 + Number(ratingKey),
    ...(watched ? { viewCount: 1, lastViewedAt: 1_700_200_000 + number } : {}),
    ...(progress ? { viewOffset: 900_000 } : {}),
    Media: [media(Number(ratingKey), 'episode')],
    ...(show.title === 'Show A'
      ? {
          Marker: [
            // S01E01 gets a short intro inside the 10 s sample clip so UI tests can exercise "Skip intro".
            season.index === 1 && number === 1
              ? { type: 'intro', startTimeOffset: 1_000, endTimeOffset: 6_000 }
              : { type: 'intro', startTimeOffset: 60_000, endTimeOffset: 120_000 },
            { type: 'credits', startTimeOffset: 2_580_000, endTimeOffset: duration, final: true },
          ],
        }
      : {}),
    ...(show.title === 'Show A' && season.index === 1 && number === 1
      ? {
          Chapter: [
            { index: 1, startTimeOffset: 0, endTimeOffset: 900_000, tag: 'Opening' },
            { index: 2, startTimeOffset: 900_000, endTimeOffset: duration, tag: 'Act Two' },
          ],
        }
      : {}),
  }
}

export function createFixtures(): Fixtures {
  const libraries: Library[] = [
    { key: '1', title: 'Movies', type: 'movie', uuid: 'library-movies' },
    { key: '2', title: 'TV Shows', type: 'show', uuid: 'library-shows' },
    { key: '3', title: 'Music', type: 'artist', uuid: 'library-music' },
  ]
  const movies = Array.from({ length: 10 }, (_, index) => movie(index + 1))
  const shows: Metadata[] = [
    {
      ratingKey: '200',
      key: '/library/metadata/200',
      type: 'show',
      title: 'Show A',
      librarySectionID: 2,
      librarySectionTitle: 'TV Shows',
      thumb: '/library/metadata/200/thumb/1',
      art: '/library/metadata/200/art/1',
      addedAt: 1_700_300_000,
      leafCount: 8,
      viewedLeafCount: 3,
      childCount: 2,
    },
    {
      ratingKey: '300',
      key: '/library/metadata/300',
      type: 'show',
      title: 'Show B',
      librarySectionID: 2,
      librarySectionTitle: 'TV Shows',
      thumb: '/library/metadata/300/thumb/1',
      art: '/library/metadata/300/art/1',
      addedAt: 1_700_400_000,
      leafCount: 3,
      viewedLeafCount: 0,
      childCount: 1,
    },
  ]
  const seasons: Metadata[] = []
  const episodes: Metadata[] = []
  for (const show of shows) {
    const seasonCount = show.title === 'Show A' ? 2 : 1
    for (let seasonNumber = 1; seasonNumber <= seasonCount; seasonNumber++) {
      const seasonKey = String(Number(show.ratingKey) + seasonNumber)
      const season: Metadata = {
        ratingKey: seasonKey,
        key: `/library/metadata/${seasonKey}`,
        type: 'season',
        title: `Season ${seasonNumber}`,
        index: seasonNumber,
        parentRatingKey: show.ratingKey,
        parentTitle: show.title,
        librarySectionID: 2,
        librarySectionTitle: 'TV Shows',
        thumb: `/library/metadata/${seasonKey}/thumb/1`,
        art: show.art,
        addedAt: show.addedAt + seasonNumber,
        leafCount: show.title === 'Show A' ? 4 : 3,
        viewedLeafCount: show.title === 'Show A' && seasonNumber === 1 ? 3 : 0,
      }
      seasons.push(season)
      const count = show.title === 'Show A' ? 4 : 3
      for (let n = 1; n <= count; n++)
        episodes.push(
          episode(
            show,
            season,
            n,
            show.title === 'Show A' && seasonNumber === 1 && n <= 3,
            show.title === 'Show A' && seasonNumber === 1 && n === 4,
          ),
        )
    }
  }
  const all = [...movies, ...shows, ...seasons, ...episodes]
  return {
    libraries,
    movies,
    shows,
    seasons,
    episodes,
    byRatingKey: new Map(all.map((item) => [item.ratingKey, item])),
    timelineEvents: [],
    scrobbles: [],
    streamSelections: {},
    transcodeSessions: new Set(),
  }
}
