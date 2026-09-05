import { plexHeaders, plexQuery, type PlexClientInfo } from './headers'
import { buildUrl, request, requestJson, type HttpOptions } from './http'
import { normalizeHub, normalizeItem, normalizeLibrary } from './normalize'
import type {
  RawContainer,
  RawMetadataContainer,
  RawSectionsContainer,
  RawServerIdentity,
} from './raw'
import type { Hub, Item, Library, Page, PlaybackState, ServerInfo } from './types'

export interface ListOptions {
  offset?: number
  limit?: number
  /** Plex sort expression, e.g. "titleSort:asc", "addedAt:desc", "lastViewedAt:desc" */
  sort?: string
  /** Plex item type filter: 1 movie, 2 show, 3 season, 4 episode */
  type?: 1 | 2 | 3 | 4
  /** Extra raw filters, e.g. { unwatched: 1, genre: 12 } */
  filters?: Record<string, string | number>
}

export interface TimelineOptions {
  ratingKey: string
  key: string
  state: PlaybackState
  timeMs: number
  durationMs: number
  /** Playback session UUID; keep it stable for the whole play session. */
  playSessionId?: string
  /** Use fetch keepalive so the ping survives page unload (final "stopped" report). */
  keepalive?: boolean
}

/** Client for one Plex Media Server. Stateless apart from base URL + token. */
export class PlexServer {
  constructor(
    public readonly baseUrl: string,
    public readonly token: string,
    public readonly client: PlexClientInfo,
    private readonly opts: HttpOptions = {},
  ) {}

  private init(extra: RequestInit = {}): RequestInit & HttpOptions {
    const out: RequestInit & HttpOptions = {
      ...extra,
      headers: {
        ...plexHeaders(this.client, this.token),
        ...(extra.headers as Record<string, string> | undefined),
      },
    }
    if (this.opts.fetch) out.fetch = this.opts.fetch
    if (this.opts.timeoutMs) out.timeoutMs = this.opts.timeoutMs
    return out
  }

  url(path: string, query?: Record<string, string | number | boolean | undefined>) {
    return buildUrl(this.baseUrl, path.replace(/^\//, ''), query)
  }

  /** URL usable by <img>/<video> (token in query string). */
  authedUrl(path: string, query: Record<string, string | number | boolean | undefined> = {}) {
    return this.url(path, { ...query, ...plexQuery(this.client, this.token) })
  }

  private async container<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const raw = await requestJson<RawContainer<T>>(this.url(path, query), this.init())
    return raw.MediaContainer
  }

  async info(): Promise<ServerInfo> {
    const c = await this.container<RawServerIdentity>('/')
    return {
      machineIdentifier: c.machineIdentifier ?? '',
      friendlyName: c.friendlyName ?? '',
      version: c.version ?? '',
      ...(c.platform ? { platform: c.platform } : {}),
      transcoderVideo: Boolean(c.transcoderVideo),
      transcoderAudio: Boolean(c.transcoderAudio),
      transcoderSubtitles: Boolean(c.transcoderSubtitles),
    }
  }

  async libraries(): Promise<Library[]> {
    const c = await this.container<RawSectionsContainer>('/library/sections')
    return (c.Directory ?? []).map(normalizeLibrary)
  }

  async libraryItems(libraryId: string, o: ListOptions = {}): Promise<Page<Item>> {
    const query: Record<string, string | number> = {
      'X-Plex-Container-Start': o.offset ?? 0,
      'X-Plex-Container-Size': o.limit ?? 50,
      includeGuids: 0,
      ...o.filters,
    }
    if (o.sort) query.sort = o.sort
    if (o.type) query.type = o.type
    const c = await this.container<RawMetadataContainer>(
      `/library/sections/${libraryId}/all`,
      query,
    )
    return {
      items: (c.Metadata ?? []).map(normalizeItem),
      offset: c.offset ?? 0,
      total: c.totalSize ?? c.size,
    }
  }

  async recentlyAdded(libraryId: string, limit = 24): Promise<Item[]> {
    const c = await this.container<RawMetadataContainer>(
      `/library/sections/${libraryId}/recentlyAdded`,
      {
        'X-Plex-Container-Start': 0,
        'X-Plex-Container-Size': limit,
      },
    )
    return (c.Metadata ?? []).map(normalizeItem)
  }

  /** Cross-library "Continue Watching" (in-progress + next-up episodes). */
  async continueWatching(limit = 24): Promise<Item[]> {
    const c = await this.container<RawMetadataContainer>('/hubs/continueWatching/items', {
      'X-Plex-Container-Start': 0,
      'X-Plex-Container-Size': limit,
    })
    return (c.Metadata ?? []).map(normalizeItem)
  }

  async onDeck(limit = 24): Promise<Item[]> {
    const c = await this.container<RawMetadataContainer>('/library/onDeck', {
      'X-Plex-Container-Start': 0,
      'X-Plex-Container-Size': limit,
    })
    return (c.Metadata ?? []).map(normalizeItem)
  }

  async libraryHubs(libraryId: string, count = 12): Promise<Hub[]> {
    const c = await this.container<RawMetadataContainer>(`/hubs/sections/${libraryId}`, {
      count,
      includeMeta: 0,
    })
    return (c.Hub ?? []).filter((h) => (h.Metadata?.length ?? 0) > 0).map(normalizeHub)
  }

  async item(ratingKey: string): Promise<Item> {
    const c = await this.container<RawMetadataContainer>(`/library/metadata/${ratingKey}`, {
      includeChapters: 1,
      includeMarkers: 1,
      includeExtras: 0,
      includeOnDeck: 0,
      checkFiles: 0,
    })
    const first = c.Metadata?.[0]
    if (!first) throw new Error(`Item ${ratingKey} not found`)
    return normalizeItem(first)
  }

  /** Seasons of a show, or episodes of a season. */
  async children(ratingKey: string): Promise<Item[]> {
    const c = await this.container<RawMetadataContainer>(
      `/library/metadata/${ratingKey}/children`,
      {
        excludeAllLeaves: 1,
      },
    )
    return (c.Metadata ?? []).map(normalizeItem)
  }

  /** Every episode of a show, across seasons. */
  async allEpisodes(showRatingKey: string): Promise<Item[]> {
    const c = await this.container<RawMetadataContainer>(
      `/library/metadata/${showRatingKey}/allLeaves`,
    )
    return (c.Metadata ?? []).map(normalizeItem)
  }

  /** Next episode to play for a show (Plex "On Deck" for that show). */
  async showOnDeck(showRatingKey: string): Promise<Item | null> {
    const c = await this.container<RawMetadataContainer>(`/library/metadata/${showRatingKey}`, {
      includeOnDeck: 1,
    })
    const od = c.Metadata?.[0]?.OnDeck?.Metadata
    return od ? normalizeItem(od) : null
  }

  async search(query: string, limit = 30): Promise<Hub[]> {
    const c = await this.container<RawMetadataContainer>('/hubs/search', {
      query,
      limit,
      includeCollections: 0,
    })
    return (c.Hub ?? []).filter((h) => (h.Metadata?.length ?? 0) > 0).map(normalizeHub)
  }

  /** Resized image through the server's photo transcoder. `path` is a thumb/art path from an Item. */
  imageUrl(path: string, width: number, height: number): string {
    return this.authedUrl('/photo/:/transcode', {
      width,
      height,
      minSize: 1,
      upscale: 1,
      url: path,
    })
  }

  // ---- playback state -------------------------------------------------------

  /** Report playback progress. Call every ~10 s while playing and on every state change. */
  async timeline(o: TimelineOptions): Promise<void> {
    await request(
      this.url('/:/timeline', {
        ratingKey: o.ratingKey,
        key: o.key,
        state: o.state,
        time: Math.floor(o.timeMs),
        duration: Math.floor(o.durationMs),
        hasMDE: 1,
        playbackTime: Math.floor(o.timeMs),
        ...(o.playSessionId ? { 'X-Plex-Session-Identifier': o.playSessionId } : {}),
      }),
      this.init(o.keepalive ? { keepalive: true } : {}),
    )
  }

  async markWatched(ratingKey: string): Promise<void> {
    await request(
      this.url('/:/scrobble', { key: ratingKey, identifier: 'com.plexapp.plugins.library' }),
      this.init(),
    )
  }

  async markUnwatched(ratingKey: string): Promise<void> {
    await request(
      this.url('/:/unscrobble', { key: ratingKey, identifier: 'com.plexapp.plugins.library' }),
      this.init(),
    )
  }

  /** Persist audio/subtitle choice on the server so every client resumes with it. */
  async selectStreams(
    partId: number,
    o: { audioStreamId?: number; subtitleStreamId?: number },
  ): Promise<void> {
    const q: Record<string, number> = { allParts: 1 }
    if (o.audioStreamId !== undefined) q.audioStreamID = o.audioStreamId
    if (o.subtitleStreamId !== undefined) q.subtitleStreamID = o.subtitleStreamId
    await request(this.url(`/library/parts/${partId}`, q), this.init({ method: 'PUT' }))
  }

  async stopTranscodeSession(sessionId: string): Promise<void> {
    await request(
      this.url('/video/:/transcode/universal/stop', { session: sessionId }),
      this.init(),
    ).catch(() => undefined)
  }
}
