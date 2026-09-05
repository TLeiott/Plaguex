/**
 * Live verification against a real Plex server using the token from .env.local.
 * Read-only apart from a transcode decision request. Usage: pnpm tsx scripts/plex-probe.ts
 */
import { readFileSync } from 'node:fs'
import {
  PlexTv,
  PlexServer,
  probeConnections,
  planPlayback,
  buildUrl,
  plexQuery,
  type PlayerCapabilities,
} from '../packages/plex-api/src/index.ts'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const get = (k: string) => new RegExp(`^${k}=(.+)$`, 'm').exec(env)?.[1]?.trim()
const accountToken = get('PLEX_TOKEN') ?? ''
const client = {
  clientIdentifier: get('PLEX_CLIENT_ID') ?? 'probe',
  product: 'Plaguex',
  version: 'dev',
  platform: 'Chrome',
  device: 'Linux',
  deviceName: 'Plaguex probe',
}

const step = async <T>(name: string, fn: () => Promise<T>, show: (v: T) => unknown = (v) => v) => {
  const t = Date.now()
  try {
    const v = await fn()
    console.log(`✓ ${name} (${Date.now() - t} ms):`, JSON.stringify(show(v)).slice(0, 400))
    return v
  } catch (e) {
    console.log(`✗ ${name}: ${e instanceof Error ? e.message : String(e)}`)
    return undefined
  }
}

const tv = new PlexTv(client)
const user = await step(
  'plex.tv user',
  () => tv.user(accountToken),
  (u) => ({ name: u.title, plexPass: u.plexPass }),
)
const servers =
  (await step(
    'plex.tv servers',
    () => tv.servers(accountToken),
    (s) =>
      s.map((x) => ({
        name: x.name,
        owned: x.owned,
        conns: x.connections.length,
        hasToken: !!x.accessToken,
      })),
  )) ?? []
const res = servers[0]!
const reachable =
  (await step(
    'probe connections',
    () => probeConnections(res, client, { timeoutMs: 6000 }),
    (r) =>
      r.map(
        (x) =>
          `${x.connection.uri} ${x.connection.local ? 'local' : x.connection.relay ? 'relay' : 'remote'} ${x.latencyMs}ms`,
      ),
  )) ?? []
const conn = reachable[0]!.connection
const serverToken = res.accessToken ?? ''
const server = new PlexServer(conn.uri, serverToken, client)

await step('server info', () => server.info())
const libs =
  (await step(
    'libraries',
    () => server.libraries(),
    (l) => l.map((x) => `${x.id}:${x.title}:${x.type}`),
  )) ?? []
const cw = await step(
  'continueWatching (/hubs/continueWatching/items)',
  () => server.continueWatching(5),
  (i) => i.map((x) => `${x.type} ${x.title} off=${x.viewOffsetMs}`),
)
await step(
  'onDeck (/library/onDeck)',
  () => server.onDeck(5),
  (i) => i.map((x) => `${x.type} ${x.title}`),
)
const movieLib = libs.find((l) => l.type === 'movie')
const showLib = libs.find((l) => l.type === 'show')
if (movieLib) {
  await step(
    'recentlyAdded',
    () => server.recentlyAdded(movieLib.id, 3),
    (i) => i.map((x) => x.title),
  )
  await step(
    'libraryHubs',
    () => server.libraryHubs(movieLib.id, 4),
    (h) => h.map((x) => `${x.identifier}:${x.items.length}`),
  )
  const page = await step(
    'libraryItems sort+paging',
    () => server.libraryItems(movieLib.id, { offset: 0, limit: 5, sort: 'addedAt:desc' }),
    (p) => ({ total: p.total, first: p.items[0]?.title }),
  )
  await step(
    'libraryItems unwatched filter',
    () => server.libraryItems(movieLib.id, { limit: 3, filters: { unwatched: 1 } }),
    (p) => ({ total: p.total }),
  )
  const first = page?.items[0]
  if (first) {
    const item = await step(
      'item (markers/chapters/media)',
      () => server.item(first.ratingKey),
      (i) => ({
        title: i.title,
        media: i.media.map((m) => `${m.container}/${m.videoCodec}/${m.audioCodec} ${m.height}p`),
        markers: i.markers.length,
        chapters: i.chapters.length,
        streams: i.media[0]?.parts[0]?.streams.map(
          (s) =>
            `${s.kind}:${s.codec}:${s.language ?? ''}${s.external ? ':ext' : ''}${s.selected ? ':sel' : ''}`,
        ),
      }),
    )
    if (item) {
      const caps: PlayerCapabilities = {
        containers: ['mp4', 'm4v', 'mov', 'webm', 'mkv'],
        videoCodecs: ['h264', 'vp9', 'av1'],
        audioCodecs: ['aac', 'mp3', 'opus', 'flac'],
        subtitleFormats: ['srt', 'subrip', 'ass', 'ssa', 'mov_text', 'vtt', 'webvtt'],
        hdr: false,
      }
      const plan = planPlayback({
        baseUrl: conn.uri,
        token: serverToken,
        client,
        item,
        caps,
        sessionId: 'probe-' + Date.now(),
      })
      console.log(`  plan: ${plan.method} ${plan.protocol} reasons=${JSON.stringify(plan.reasons)}`)
      await step('HEAD direct file URL', async () => {
        const r = await fetch(
          plan.method === 'directplay'
            ? plan.url
            : buildUrl(
                conn.uri,
                item.media[0]!.parts[0]!.key.replace(/^\//, ''),
                plexQuery(client, serverToken),
              ),
          { method: 'HEAD' },
        )
        return {
          status: r.status,
          type: r.headers.get('content-type'),
          len: r.headers.get('content-length'),
          ranges: r.headers.get('accept-ranges'),
        }
      })
      await step('transcode decision', async () => {
        const u = plan.url.replace('start.m3u8', 'decision').replace(/([?&])path=/, '$1path=')
        const r = await fetch(
          u.includes('decision')
            ? u
            : buildUrl(conn.uri, 'video/:/transcode/universal/decision', {
                ...plexQuery(client, serverToken),
                path: `/library/metadata/${item.ratingKey}`,
                mediaIndex: 0,
                partIndex: 0,
                protocol: 'hls',
                directPlay: 0,
                directStream: 1,
                hasMDE: 1,
                session: 'probe-dec',
              }),
          { headers: { Accept: 'application/json' } },
        )
        const j = (await r.json()) as { MediaContainer: Record<string, unknown> }
        const mc = j.MediaContainer
        return {
          status: r.status,
          general: mc.generalDecisionCode,
          generalText: mc.generalDecisionText,
          transcode: mc.transcodeDecisionCode,
          transcodeText: mc.transcodeDecisionText,
          directPlay: mc.directPlayDecisionCode,
          directPlayText: mc.directPlayDecisionText,
        }
      })
      if (plan.protocol === 'hls')
        await step('HLS start.m3u8 fetch', async () => {
          const r = await fetch(plan.url)
          const t = await r.text()
          await server.stopTranscodeSession(plan.sessionId)
          return { status: r.status, head: t.split('\n').slice(0, 6).join(' | ') }
        })
      const sub = item.media[0]?.parts[0]?.streams.find((s) => s.kind === 'subtitle')
      if (sub)
        await step(
          `subtitle stream ${sub.id} (${sub.codec}, external=${sub.external}) as webvtt`,
          async () => {
            const r = await fetch(
              buildUrl(conn.uri, `library/streams/${sub.id}`, {
                encoding: 'utf-8',
                format: 'webvtt',
                ...plexQuery(client, serverToken),
              }),
            )
            return {
              status: r.status,
              type: r.headers.get('content-type'),
              head: (await r.text()).slice(0, 80),
            }
          },
        )
      await step('imageUrl thumb', async () => {
        const r = await fetch(server.imageUrl(item.thumb!, 200, 300), { method: 'HEAD' })
        return { status: r.status, type: r.headers.get('content-type') }
      })
    }
  }
}
if (showLib) {
  const shows = await step(
    'shows page',
    () => server.libraryItems(showLib.id, { limit: 2, sort: 'lastViewedAt:desc' }),
    (p) => p.items.map((x) => `${x.title} leaf=${x.leafCount}/${x.viewedLeafCount}`),
  )
  const show = shows?.items[0]
  if (show) {
    const seasons = await step(
      'children (seasons)',
      () => server.children(show.ratingKey),
      (s) => s.map((x) => `${x.title} idx=${x.index}`),
    )
    await step(
      'showOnDeck',
      () => server.showOnDeck(show.ratingKey),
      (i) => i && `${i.grandparentTitle} S${i.parentIndex}E${i.index} ${i.title}`,
    )
    const eps = await step(
      'allEpisodes',
      () => server.allEpisodes(show.ratingKey),
      (e) => ({ count: e.length, first: e[0] && `S${e[0].parentIndex}E${e[0].index}` }),
    )
    const ep = eps?.[0]
    if (ep)
      await step(
        'episode item markers',
        () => server.item(ep.ratingKey),
        (i) => ({
          markers: i.markers.map((m) => `${m.type} ${m.startMs}-${m.endMs}`),
          chapters: i.chapters.length,
        }),
      )
    if (seasons?.[0])
      await step(
        'children (episodes of season)',
        () => server.children(seasons[0]!.ratingKey),
        (e) => e.length,
      )
  }
}
await step(
  'search',
  () => server.search('the', 5),
  (h) => h.map((x) => `${x.type}:${x.items.length}`),
)
console.log(
  '\nuser:',
  user?.title,
  '| server:',
  res.name,
  '| via',
  conn.uri,
  cw ? '' : '(continueWatching failed)',
)
