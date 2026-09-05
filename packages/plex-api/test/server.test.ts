import { describe, expect, it, vi } from 'vitest'
import type { PlexClientInfo } from '../src/headers'
import type { RawMetadata } from '../src/raw'
import { PlexServer } from '../src/server'

const client: PlexClientInfo = {
  clientIdentifier: 'cid',
  product: 'Plaguex',
  version: '1',
  platform: 'Web',
  device: 'Browser',
  deviceName: 'Tim',
}
const metadata = (ratingKey = '1', title = 'Film'): RawMetadata => ({
  ratingKey,
  key: `/library/metadata/${ratingKey}`,
  type: 'movie',
  title,
})
const response = (MediaContainer: unknown, status = 200) =>
  new Response(JSON.stringify({ MediaContainer }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('PlexServer', () => {
  it('builds plain and authenticated URLs', () => {
    const server = new PlexServer('http://plex.test/', 'token', client)
    expect(server.url('/library')).toBe('http://plex.test/library')
    const url = new URL(server.authedUrl('/image', { width: 100 }))
    expect(url.searchParams.get('width')).toBe('100')
    expect(url.searchParams.get('X-Plex-Token')).toBe('token')
  })

  it('loads server info and libraries', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          machineIdentifier: 'm',
          friendlyName: 'Home',
          version: '1',
          platform: 'Linux',
          transcoderVideo: 1,
        }),
      )
      .mockResolvedValueOnce(
        response({ size: 1, Directory: [{ key: '1', title: 'Movies', type: 'movie' }] }),
      )
    const server = new PlexServer('http://plex.test', 'token', client, { fetch })
    await expect(server.info()).resolves.toMatchObject({
      machineIdentifier: 'm',
      friendlyName: 'Home',
      platform: 'Linux',
      transcoderVideo: true,
      transcoderAudio: false,
    })
    await expect(server.libraries()).resolves.toEqual([{ id: '1', title: 'Movies', type: 'movie' }])
  })

  it('sends paging, sorting, type, and filters for library items', async () => {
    const fetch = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(response({ size: 1, totalSize: 8, offset: 2, Metadata: [metadata()] })),
    )
    const page = await new PlexServer('http://plex.test', 'token', client, { fetch }).libraryItems(
      '4',
      { offset: 2, limit: 3, sort: 'addedAt:desc', type: 1, filters: { unwatched: 1, genre: 12 } },
    )
    const url = new URL(fetch.mock.calls[0]?.[0] ?? '')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      'X-Plex-Container-Start': '2',
      'X-Plex-Container-Size': '3',
      sort: 'addedAt:desc',
      type: '1',
      unwatched: '1',
      genre: '12',
    })
    expect(page).toMatchObject({ offset: 2, total: 8, items: [{ title: 'Film' }] })
  })

  it('requests markers for an item and rejects an empty result', async () => {
    const fetch = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response({ size: 1, Metadata: [metadata('7')] }))
      .mockResolvedValueOnce(response({ size: 0, Metadata: [] }))
    const server = new PlexServer('http://plex.test', 'token', client, { fetch })
    await expect(server.item('7')).resolves.toMatchObject({ ratingKey: '7' })
    expect(new URL(fetch.mock.calls[0]?.[0] ?? '').searchParams.get('includeMarkers')).toBe('1')
    await expect(server.item('missing')).rejects.toThrow('Item missing not found')
  })

  it('loads children, all episodes, show on-deck, and search hubs', async () => {
    const onDeck = metadata('3', 'Next')
    const fetch = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response({ size: 1, Metadata: [metadata('2', 'Season')] }))
      .mockResolvedValueOnce(response({ size: 1, Metadata: [metadata('3', 'Episode')] }))
      .mockResolvedValueOnce(
        response({ size: 1, Metadata: [{ ...metadata('show'), OnDeck: { Metadata: onDeck } }] }),
      )
      .mockResolvedValueOnce(
        response({
          size: 1,
          Hub: [
            {
              hubIdentifier: 'search',
              title: 'Results',
              type: 'movie',
              size: 1,
              Metadata: [metadata()],
            },
          ],
        }),
      )
    const server = new PlexServer('http://plex.test', 'token', client, { fetch })
    await expect(server.children('show')).resolves.toEqual([
      expect.objectContaining({ title: 'Season' }),
    ])
    await expect(server.allEpisodes('show')).resolves.toEqual([
      expect.objectContaining({ title: 'Episode' }),
    ])
    await expect(server.showOnDeck('show')).resolves.toMatchObject({ title: 'Next' })
    await expect(server.search('film', 5)).resolves.toEqual([
      expect.objectContaining({ identifier: 'search' }),
    ])
    expect(fetch.mock.calls.map((call) => new URL(call[0]).pathname)).toEqual([
      '/library/metadata/show/children',
      '/library/metadata/show/allLeaves',
      '/library/metadata/show',
      '/hubs/search',
    ])
  })

  it('builds image and playback-state URLs', async () => {
    const fetch = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response('', { status: 200 })),
    )
    const server = new PlexServer('http://plex.test', 'token', client, { fetch })
    const image = new URL(server.imageUrl('/library/metadata/1/thumb/2', 640, 360))
    expect(image.pathname).toBe('/photo/:/transcode')
    expect(Object.fromEntries(image.searchParams)).toMatchObject({
      width: '640',
      height: '360',
      url: '/library/metadata/1/thumb/2',
      'X-Plex-Token': 'token',
    })
    await server.timeline({
      ratingKey: '1',
      key: '/library/metadata/1',
      state: 'playing',
      timeMs: 12.9,
      durationMs: 99.8,
    })
    expect(Object.fromEntries(new URL(fetch.mock.calls[0]?.[0] ?? '').searchParams)).toMatchObject({
      ratingKey: '1',
      key: '/library/metadata/1',
      state: 'playing',
      time: '12',
      duration: '99',
    })
  })

  it('marks watched state and selects streams with PUT, including subtitle zero', async () => {
    const fetch = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response('', { status: 200 })),
    )
    const server = new PlexServer('http://plex.test', 'token', client, { fetch })
    await server.markWatched('1')
    await server.markUnwatched('1')
    await server.selectStreams(9, { audioStreamId: 2, subtitleStreamId: 0 })
    const urls = fetch.mock.calls.map((call) => new URL(call[0]))
    expect(urls[0]?.pathname).toBe('/:/scrobble')
    expect(urls[1]?.pathname).toBe('/:/unscrobble')
    expect(urls[0]?.searchParams.get('identifier')).toBe('com.plexapp.plugins.library')
    expect(Object.fromEntries(urls[2]?.searchParams ?? [])).toMatchObject({
      allParts: '1',
      audioStreamID: '2',
      subtitleStreamID: '0',
    })
    expect(fetch.mock.calls[2]?.[1]?.method).toBe('PUT')
  })

  it('swallows transcode-stop failures', async () => {
    const server = new PlexServer('http://plex.test', 'token', client, {
      fetch: () => Promise.reject(new Error('offline')),
    })
    await expect(server.stopTranscodeSession('session')).resolves.toBeUndefined()
  })
})
