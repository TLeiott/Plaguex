import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createFixtures, type Fixtures, type Media, type Metadata, type Part } from './fixtures'
import { mediaPath, mediaResponse } from './media'

export interface MockPlexOptions {
  token?: string
  baseUrl?: string
  plexTvPinAutoClaimAfter?: number
}

interface PinState {
  id: number
  code: string
  expiresIn: number
  createdAt: string
  expiresAt: string
  authToken: string | null
  clientIdentifier: string
  polls: number
}

const container = (value: object) => ({ MediaContainer: value })

function page(
  items: Metadata[],
  request: Request,
): { items: Metadata[]; offset: number; total: number } {
  const url = new URL(request.url)
  const offset = Number(url.searchParams.get('X-Plex-Container-Start') ?? 0)
  const size = Number(url.searchParams.get('X-Plex-Container-Size') ?? 50)
  return { items: items.slice(offset, offset + size), offset, total: items.length }
}

function compare(sort: string): (a: Metadata, b: Metadata) => number {
  const [field = 'titleSort', direction = 'asc'] = sort.split(':')
  const sign = direction === 'desc' ? -1 : 1
  return (a, b) => {
    const av =
      field === 'titleSort'
        ? (a.titleSort ?? a.title)
        : ((a[field as keyof Metadata] as string | number | undefined) ?? 0)
    const bv =
      field === 'titleSort'
        ? (b.titleSort ?? b.title)
        : ((b[field as keyof Metadata] as string | number | undefined) ?? 0)
    return (
      (typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : Number(av) - Number(bv)) * sign
    )
  }
}

function allParts(state: Fixtures): Part[] {
  return [...state.movies, ...state.episodes]
    .flatMap((item) => item.Media ?? [])
    .flatMap((entry) => entry.Part)
}

function nextEpisode(state: Fixtures, showKey: string): Metadata | undefined {
  return state.episodes
    .filter((item) => item.grandparentRatingKey === showKey && !item.viewCount)
    .sort(
      (a, b) => (a.parentIndex ?? 0) - (b.parentIndex ?? 0) || (a.index ?? 0) - (b.index ?? 0),
    )[0]
}

function svg(title: string, key: string): string {
  let hash = 0
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const color = `hsl(${hash % 360} 55% 35%)`
  const safe = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="${color}"/><text x="400" y="225" fill="white" font-family="sans-serif" font-size="42" text-anchor="middle">${safe}</text></svg>`
}

export function createMockPlex(opts: MockPlexOptions = {}): { app: Hono; state: Fixtures } {
  const token = opts.token ?? 'mock-token'
  const state = createFixtures()
  const app = new Hono()
  const pins = new Map<number, PinState>()
  let nextPinId = 1000

  // Real PMS and plex.tv answer CORS preflights for X-Plex-* headers; browsers need this to talk to us directly.
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges'],
    }),
  )
  app.use('*', async (c, next) => {
    const path = c.req.path
    if (
      path === '/identity' ||
      path.startsWith('/_mock/') ||
      path.startsWith('/plextv/') ||
      path.startsWith('/video/:/transcode/universal/session/')
    )
      return next()
    if (c.req.header('X-Plex-Token') !== token && c.req.query('X-Plex-Token') !== token)
      return c.json({ error: 'Unauthorized' }, 401)
    return next()
  })

  app.get('/identity', (c) =>
    c.json(container({ machineIdentifier: 'mock-server-1', version: '1.41.0' })),
  )
  app.get('/', (c) =>
    c.json(
      container({
        machineIdentifier: 'mock-server-1',
        friendlyName: 'Mock Plex',
        version: '1.41.0',
        platform: 'Linux',
        transcoderVideo: true,
        transcoderAudio: true,
        transcoderSubtitles: true,
      }),
    ),
  )

  app.get('/library/sections', (c) =>
    c.json(container({ size: state.libraries.length, Directory: state.libraries })),
  )
  app.get('/library/sections/:id/all', (c) => {
    const id = c.req.param('id')
    const itemType = c.req.query('type')
    let items =
      id === '1'
        ? [...state.movies]
        : id === '2'
          ? itemType === '4'
            ? [...state.episodes]
            : [...state.shows]
          : []
    if (itemType === '1') items = items.filter((item) => item.type === 'movie')
    if (itemType === '2') items = items.filter((item) => item.type === 'show')
    if (itemType === '4')
      items = state.episodes.filter((item) => item.librarySectionID === Number(id))
    if (c.req.query('unwatched') === '1') items = items.filter((item) => !item.viewCount)
    items.sort(compare(c.req.query('sort') ?? 'titleSort:asc'))
    const result = page(items, c.req.raw)
    const library = state.libraries.find((entry) => entry.key === id)
    return c.json(
      container({
        size: result.items.length,
        totalSize: result.total,
        offset: result.offset,
        librarySectionID: Number(id),
        librarySectionTitle: library?.title ?? '',
        Metadata: result.items,
      }),
    )
  })
  app.get('/library/sections/:id/recentlyAdded', (c) => {
    const id = c.req.param('id')
    const items = (
      id === '1' ? state.movies : id === '2' ? [...state.shows, ...state.episodes] : []
    ).toSorted(compare('addedAt:desc'))
    const result = page(items, c.req.raw)
    return c.json(
      container({
        size: result.items.length,
        totalSize: result.total,
        offset: result.offset,
        Metadata: result.items,
      }),
    )
  })

  const continueItems = (): Metadata[] => {
    const found = [...state.movies, ...state.episodes].filter((item) => (item.viewOffset ?? 0) > 0)
    for (const show of state.shows.filter((item) => (item.viewedLeafCount ?? 0) > 0)) {
      const next = nextEpisode(state, show.ratingKey)
      if (next && !found.includes(next)) found.push(next)
    }
    return found
  }
  app.get('/hubs/continueWatching/items', (c) => {
    const result = page(continueItems(), c.req.raw)
    return c.json(
      container({
        size: result.items.length,
        totalSize: result.total,
        offset: result.offset,
        Metadata: result.items,
      }),
    )
  })
  app.get('/library/onDeck', (c) => {
    const items = state.shows
      .map((show) => nextEpisode(state, show.ratingKey))
      .filter((item): item is Metadata => Boolean(item))
    const result = page(items, c.req.raw)
    return c.json(
      container({
        size: result.items.length,
        totalSize: result.total,
        offset: result.offset,
        Metadata: result.items,
      }),
    )
  })
  app.get('/hubs/sections/:id', (c) => {
    const id = c.req.param('id')
    const count = Number(c.req.query('count') ?? 12)
    const source = id === '1' ? state.movies : [...state.shows, ...state.episodes]
    const definitions = [
      {
        title: 'Recently Added',
        identifier: 'home.recentlyadded',
        items: source.toSorted(compare('addedAt:desc')),
      },
      {
        title: 'Continue Watching',
        identifier: 'home.continue',
        items: continueItems().filter((item) => item.librarySectionID === Number(id)),
      },
      {
        title: 'Top Rated',
        identifier: 'home.toprated',
        items: source.toSorted(compare('rating:desc')),
      },
    ]
    const Hub = definitions.map((hub) => ({
      title: hub.title,
      type: id === '1' ? 'movie' : 'mixed',
      hubIdentifier: hub.identifier,
      size: Math.min(hub.items.length, count),
      more: hub.items.length > count,
      Metadata: hub.items.slice(0, count),
    }))
    return c.json(container({ size: Hub.length, Hub }))
  })
  app.get('/hubs/search', (c) => {
    const query = (c.req.query('query') ?? '').toLocaleLowerCase()
    const limit = Number(c.req.query('limit') ?? 30)
    const groups = [state.movies, state.shows, state.episodes]
    const Hub = groups.map((items) => {
      const matches = items
        .filter((item) => item.title.toLocaleLowerCase().includes(query))
        .slice(0, limit)
      const type = items[0]?.type ?? 'unknown'
      return {
        title: type === 'movie' ? 'Movies' : type === 'show' ? 'Shows' : 'Episodes',
        type,
        hubIdentifier: `search.${type}`,
        size: matches.length,
        more: false,
        Metadata: matches,
      }
    })
    return c.json(container({ size: Hub.length, Hub }))
  })

  app.get('/library/metadata/:rk/children', (c) => {
    const item = state.byRatingKey.get(c.req.param('rk'))
    if (!item) return c.json(container({ size: 0, Metadata: [] }), 404)
    const items =
      item.type === 'show'
        ? state.seasons.filter((season) => season.parentRatingKey === item.ratingKey)
        : item.type === 'season'
          ? state.episodes.filter((episode) => episode.parentRatingKey === item.ratingKey)
          : []
    return c.json(container({ size: items.length, Metadata: items }))
  })
  app.get('/library/metadata/:rk/allLeaves', (c) => {
    const items = state.episodes.filter(
      (episode) => episode.grandparentRatingKey === c.req.param('rk'),
    )
    return c.json(container({ size: items.length, Metadata: items }))
  })
  app.get('/library/metadata/:rk', (c) => {
    const item = state.byRatingKey.get(c.req.param('rk'))
    if (!item) return c.json(container({ size: 0, Metadata: [] }), 404)
    if (c.req.query('includeOnDeck') === '1' && item.type === 'show') {
      const onDeck = nextEpisode(state, item.ratingKey)
      return c.json(
        container({
          size: 1,
          Metadata: [{ ...item, ...(onDeck ? { OnDeck: { Metadata: onDeck } } : {}) }],
        }),
      )
    }
    return c.json(container({ size: 1, Metadata: [item] }))
  })

  app.get('/library/metadata/:rk/thumb/:n', (c) => {
    const item = state.byRatingKey.get(c.req.param('rk'))
    return c.body(svg(item?.title ?? 'Unknown', c.req.param('rk')), 200, {
      'Content-Type': 'image/svg+xml',
    })
  })
  app.get('/library/metadata/:rk/art/:n', (c) => {
    const item = state.byRatingKey.get(c.req.param('rk'))
    return c.body(svg(item?.title ?? 'Unknown', c.req.param('rk')), 200, {
      'Content-Type': 'image/svg+xml',
    })
  })
  app.get('/photo/*', (c) => {
    const source = c.req.query('url') ?? ''
    const ratingKey = /metadata\/(\d+)/.exec(source)?.[1] ?? '0'
    const item = state.byRatingKey.get(ratingKey)
    return c.body(svg(item?.title ?? 'Mock Plex', ratingKey), 200, {
      'Content-Type': 'image/svg+xml',
    })
  })

  app.get('/library/parts/:partId/:ts/:filename', async (c) => {
    const part = allParts(state).find((entry) => entry.id === Number(c.req.param('partId')))
    if (!part) return c.json({ error: 'Part not found' }, 404)
    const disposition =
      c.req.query('download') === '1' ? `attachment; filename="${basename(part.file)}"` : undefined
    return mediaResponse(
      c.req.raw,
      mediaPath('sample.mp4'),
      part.container === 'mp4' ? 'video/mp4' : 'video/x-matroska',
      disposition,
    )
  })
  app.get('/library/streams/:id', (c) =>
    c.body('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nMock subtitle\n', 200, {
      'Content-Type': 'text/vtt; charset=utf-8',
    }),
  )

  app.get('/video/*', async (c) => {
    const path = c.req.path
    if (path.endsWith('/start.m3u8')) {
      const session = c.req.query('session') ?? 'mock-session'
      state.transcodeSessions.add(session)
      const playlist = await readFile(mediaPath('hls', 'index.m3u8'), 'utf8')
      const rewritten = playlist.replace(
        /^(?!#)(.+\.ts)$/gm,
        `/video/:/transcode/universal/session/${encodeURIComponent(session)}/base/$1`,
      )
      return c.body(rewritten, 200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
    }
    const segment = /\/session\/[^/]+\/base\/([^/]+\.ts)$/.exec(path)?.[1]
    if (segment) return mediaResponse(c.req.raw, mediaPath('hls', segment), 'video/mp2t')
    if (path.endsWith('/decision')) {
      const ratingKey = /metadata\/(\d+)/.exec(c.req.query('path') ?? '')?.[1]
      const item = ratingKey ? state.byRatingKey.get(ratingKey) : undefined
      const media = item?.Media?.[Number(c.req.query('mediaIndex') ?? 0)]
      const direct = media?.videoCodec === 'h264'
      const decisionMedia: Media | undefined = media
        ? { ...media, Part: media.Part.map((part) => ({ ...part, decision: 'copy' }) as Part) }
        : undefined
      return c.json(
        container({
          generalDecisionCode: 1001,
          generalDecisionText: direct ? 'Direct play OK' : 'Transcode required',
          ...(direct ? {} : { transcodeDecisionCode: 1001 }),
          ...(decisionMedia ? { Metadata: [{ ...item, Media: [decisionMedia] }] } : {}),
        }),
      )
    }
    if (path.endsWith('/stop')) {
      const session = c.req.query('session')
      if (session) state.transcodeSessions.delete(session)
      return c.body(null, 200)
    }
    return c.json({ error: 'Not found' }, 404)
  })

  app.get('/:colon/timeline', (c) => {
    const ratingKey = c.req.query('ratingKey')
    const playbackState = c.req.query('state')
    const time = Number(c.req.query('time'))
    const duration = Number(c.req.query('duration'))
    const item = ratingKey ? state.byRatingKey.get(ratingKey) : undefined
    const validState =
      playbackState !== undefined &&
      ['playing', 'paused', 'stopped', 'buffering'].includes(playbackState)
    if (
      !item ||
      !validState ||
      !Number.isFinite(time) ||
      !Number.isFinite(duration) ||
      time < 0 ||
      duration < 0
    )
      return c.json({ error: 'Invalid timeline' }, 400)
    state.timelineEvents.push({ ratingKey: ratingKey!, state: playbackState, time, duration })
    if (playbackState === 'stopped' && duration > 0 && time / duration > 0.9) {
      item.viewCount = (item.viewCount ?? 0) + 1
      delete item.viewOffset
    } else item.viewOffset = time
    return c.body(null, 200)
  })
  app.get('/:colon/scrobble', (c) => {
    const key = c.req.query('key')
    const item = key ? state.byRatingKey.get(key) : undefined
    if (!item || !key) return c.json({ error: 'Unknown item' }, 400)
    item.viewCount = (item.viewCount ?? 0) + 1
    delete item.viewOffset
    state.scrobbles.push(key)
    return c.body(null, 200)
  })
  app.get('/:colon/unscrobble', (c) => {
    const key = c.req.query('key')
    const item = key ? state.byRatingKey.get(key) : undefined
    if (!item) return c.json({ error: 'Unknown item' }, 400)
    item.viewCount = 0
    delete item.viewOffset
    return c.body(null, 200)
  })
  app.put('/library/parts/:partId', (c) => {
    const partId = c.req.param('partId')
    const part = allParts(state).find((entry) => entry.id === Number(partId))
    if (!part) return c.json({ error: 'Part not found' }, 404)
    const audio = c.req.query('audioStreamID')
    const subtitle = c.req.query('subtitleStreamID')
    if (audio !== undefined)
      for (const stream of part.Stream.filter((entry) => entry.streamType === 2))
        stream.selected = stream.id === Number(audio)
    if (subtitle !== undefined)
      for (const stream of part.Stream.filter((entry) => entry.streamType === 3))
        stream.selected = Number(subtitle) !== 0 && stream.id === Number(subtitle)
    state.streamSelections[partId] = {
      ...(audio !== undefined ? { audioStreamID: Number(audio) } : {}),
      ...(subtitle !== undefined ? { subtitleStreamID: Number(subtitle) } : {}),
    }
    return c.body(null, 200)
  })

  const rawPin = (pin: PinState) => ({
    id: pin.id,
    code: pin.code,
    expiresIn: pin.expiresIn,
    createdAt: pin.createdAt,
    expiresAt: pin.expiresAt,
    authToken: pin.authToken,
    clientIdentifier: pin.clientIdentifier,
  })
  // Stand-in for app.plex.tv/auth so browser-driven tests have a page to land on.
  app.get('/plextv/auth', (c) =>
    c.html(
      '<!doctype html><title>Mock Plex Auth</title><body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem"><h1>Mock Plex</h1><p>Device approved. You can close this tab.</p></body>',
    ),
  )

  app.post('/plextv/api/v2/pins', (c) => {
    const id = nextPinId++
    const created = new Date() // real clock: clients reject PINs whose expiresAt is in the past
    const pin: PinState = {
      id,
      code: id.toString(36).toUpperCase().slice(-4).padStart(4, '0'),
      expiresIn: 1800,
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + 1_800_000).toISOString(),
      authToken: null,
      clientIdentifier: c.req.header('X-Plex-Client-Identifier') ?? 'mock-client',
      polls: 0,
    }
    pins.set(id, pin)
    return c.json(rawPin(pin))
  })
  app.get('/plextv/api/v2/pins/:id', (c) => {
    const pin = pins.get(Number(c.req.param('id')))
    if (!pin) return c.json({ error: 'Pin not found' }, 404)
    pin.polls++
    if (opts.plexTvPinAutoClaimAfter !== undefined && pin.polls >= opts.plexTvPinAutoClaimAfter)
      pin.authToken = token
    return c.json(rawPin(pin))
  })
  app.post('/plextv/_claim/:id', (c) => {
    const pin = pins.get(Number(c.req.param('id')))
    if (!pin) return c.json({ error: 'Pin not found' }, 404)
    pin.authToken = token
    return c.json(rawPin(pin))
  })
  app.get('/plextv/api/v2/user', (c) =>
    c.json({
      id: 1,
      uuid: 'mock-user-uuid',
      username: 'mockuser',
      title: 'Mock User',
      thumb: 'https://example.invalid/mock-user.png',
      subscription: { active: false },
    }),
  )
  app.get('/plextv/api/v2/resources', (c) => {
    const uri = opts.baseUrl ?? 'http://127.0.0.1:32400'
    const parsed = new URL(uri)
    return c.json([
      {
        name: 'Mock Plex',
        product: 'Plex Media Server',
        productVersion: '1.41.0',
        platform: 'Linux',
        clientIdentifier: 'mock-server-1',
        createdAt: '2026-01-01T00:00:00Z',
        lastSeenAt: '2026-01-01T00:00:00Z',
        provides: 'server',
        owned: true,
        accessToken: token,
        httpsRequired: false,
        presence: true,
        connections: [
          {
            protocol: 'http',
            address: '127.0.0.1',
            port: Number(parsed.port || 32400),
            uri,
            local: true,
            relay: false,
            IPv6: false,
          },
          {
            protocol: 'http',
            address: '10.255.255.1',
            port: 32400,
            uri: 'http://10.255.255.1:32400',
            local: false,
            relay: false,
            IPv6: false,
          },
        ],
      },
    ])
  })
  app.delete('/plextv/api/v2/users/signout', (c) => c.body(null, 204))

  app.get('/_mock/state', (c) =>
    c.json({
      timelineEvents: state.timelineEvents,
      scrobbles: state.scrobbles,
      streamSelections: state.streamSelections,
    }),
  )
  app.post('/_mock/reset', (c) => {
    Object.assign(state, createFixtures())
    return c.json({ ok: true })
  })
  return { app, state }
}
