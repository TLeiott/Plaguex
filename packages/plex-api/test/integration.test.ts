import { createMockPlex } from '@plaguex/mock-plex'
import { beforeEach, describe, expect, it } from 'vitest'
import { PlexServer, PlexTv, planPlayback, type PlexClientInfo } from '../src/index'

const client: PlexClientInfo = {
  clientIdentifier: 'integration-client',
  product: 'Plaguex Test',
  version: '1.0.0',
  platform: 'Web',
  device: 'Browser',
  deviceName: 'Vitest',
}

describe('plex-api against mock-plex', () => {
  let mock: ReturnType<typeof createMockPlex>
  let server: PlexServer
  let plexTv: PlexTv

  beforeEach(() => {
    mock = createMockPlex({ baseUrl: 'http://mock' })
    const fetch = async (url: string, init?: RequestInit) => mock.app.request(url, init)
    server = new PlexServer('http://mock', 'mock-token', client, { fetch })
    plexTv = new PlexTv(client, { baseUrl: 'http://mock/plextv', fetch })
  })

  it('navigates libraries, metadata, shows, and discovery', async () => {
    expect(await server.libraries()).toHaveLength(3)
    const page = await server.libraryItems('1', { offset: 2, limit: 3, sort: 'year:desc' })
    expect(page).toMatchObject({ offset: 2, total: 10 })
    expect(page.items).toHaveLength(3)
    const episode = await server.item('2011')
    expect(episode.markers.map((marker) => marker.type)).toEqual(['intro', 'credits'])
    expect(episode.chapters).toHaveLength(2)
    expect(await server.children('200')).toHaveLength(2)
    expect(await server.allEpisodes('200')).toHaveLength(8)
    expect((await server.continueWatching()).length).toBeGreaterThan(0)
    expect((await server.search('movie 01'))[0]?.items[0]?.ratingKey).toBe('101')
  })

  it('writes playback state and stream selections', async () => {
    await server.timeline({
      ratingKey: '101',
      key: '/library/metadata/101',
      state: 'playing',
      timeMs: 1234,
      durationMs: 10_000,
    })
    expect(mock.state.timelineEvents[0]?.time).toBe(1234)
    await server.markWatched('102')
    expect(mock.state.byRatingKey.get('102')?.viewCount).toBe(1)
    const part = mock.state.movies[2]!.Media![0]!.Part[0]!
    const audio = part.Stream.find((stream) => stream.streamType === 2)!
    const subtitle = part.Stream.find(
      (stream) => stream.streamType === 3 && stream.codec === 'srt',
    )!
    await server.selectStreams(part.id, { audioStreamId: audio.id, subtitleStreamId: subtitle.id })
    expect(mock.state.streamSelections[String(part.id)]).toEqual({
      audioStreamID: audio.id,
      subtitleStreamID: subtitle.id,
    })
  })

  it('uses PlexTv for pins, users, and servers', async () => {
    const pin = await plexTv.createPin()
    expect(await plexTv.checkPin(pin.id)).toBeNull()
    await mock.app.request(`http://mock/plextv/_claim/${pin.id}`, { method: 'POST' })
    expect(await plexTv.checkPin(pin.id)).toBe('mock-token')
    expect(await plexTv.user('mock-token')).toMatchObject({ username: 'mockuser', plexPass: false })
    expect((await plexTv.servers('mock-token'))[0]).toMatchObject({
      clientIdentifier: 'mock-server-1',
      accessToken: 'mock-token',
    })
  })

  it('plans direct play for h264/mp4 and HLS for hevc/mkv', async () => {
    const caps = {
      containers: ['mp4', 'webm'],
      videoCodecs: ['h264', 'vp9'],
      audioCodecs: ['aac', 'opus'],
      subtitleFormats: ['srt', 'vtt'],
      maxHeight: 1080,
      hdr: false,
    }
    const direct = planPlayback({
      baseUrl: 'http://mock',
      token: 'mock-token',
      client,
      item: await server.item('101'),
      caps,
      sessionId: 'direct-session',
    })
    const hls = planPlayback({
      baseUrl: 'http://mock',
      token: 'mock-token',
      client,
      item: await server.item('102'),
      caps,
      sessionId: 'hls-session',
    })
    expect(direct).toMatchObject({ method: 'directplay', protocol: 'file' })
    expect(hls).toMatchObject({ method: 'transcode', protocol: 'hls' })
  })
})
