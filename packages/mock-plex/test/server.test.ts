import { beforeEach, describe, expect, it } from 'vitest'
import { createMockPlex } from '../src/index'

describe('mock Plex server', () => {
  let mock: ReturnType<typeof createMockPlex>
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('X-Plex-Token', 'mock-token')
    return mock.app.request(`http://mock${path}`, { ...init, headers })
  }
  const payload = async (path: string) =>
    (await (await request(path)).json()) as { MediaContainer: Record<string, unknown> }

  beforeEach(() => {
    mock = createMockPlex()
  })

  it('requires authentication and lists sections', async () => {
    expect((await mock.app.request('http://mock/library/sections')).status).toBe(401)
    const body = await payload('/library/sections')
    expect(body.MediaContainer).toMatchObject({ size: 3 })
    expect(body.MediaContainer.Directory).toHaveLength(3)
  })

  it('pages, sorts, and filters library items', async () => {
    const body = await payload(
      '/library/sections/1/all?X-Plex-Container-Start=2&X-Plex-Container-Size=3&sort=year:desc',
    )
    expect(body.MediaContainer).toMatchObject({ size: 3, totalSize: 10, offset: 2 })
    const items = body.MediaContainer.Metadata as { year: number }[]
    expect(items.map((item) => item.year)).toEqual([2008, 2007, 2006])
    const unwatched = await payload('/library/sections/1/all?unwatched=1')
    expect(unwatched.MediaContainer.totalSize).toBe(8)
  })

  it('returns metadata, seasons, episodes, and leaves', async () => {
    expect((await payload('/library/metadata/200')).MediaContainer.Metadata).toHaveLength(1)
    expect((await payload('/library/metadata/200/children')).MediaContainer.Metadata).toHaveLength(
      2,
    )
    expect((await payload('/library/metadata/201/children')).MediaContainer.Metadata).toHaveLength(
      4,
    )
    expect((await payload('/library/metadata/200/allLeaves')).MediaContainer.Metadata).toHaveLength(
      8,
    )
  })

  it('offers continue watching and type-grouped search', async () => {
    const watching = await payload('/hubs/continueWatching/items')
    expect(
      (watching.MediaContainer.Metadata as { ratingKey: string }[]).map((item) => item.ratingKey),
    ).toContain('105')
    const search = await payload('/hubs/search?query=episode%201')
    const hubs = search.MediaContainer.Hub as { type: string; Metadata: unknown[] }[]
    expect(hubs.find((hub) => hub.type === 'episode')?.Metadata.length).toBeGreaterThan(0)
  })

  it('supports ranges and download filenames', async () => {
    const part = mock.state.movies[0]!.Media![0]!.Part[0]!
    const ranged = await request(part.key, { headers: { Range: 'bytes=0-99' } })
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get('Content-Range')).toMatch(/^bytes 0-99\//)
    expect((await ranged.arrayBuffer()).byteLength).toBe(100)
    const download = await request(`${part.key}?download=1`)
    expect(download.headers.get('Content-Disposition')).toBe('attachment; filename="Movie 1.mp4"')
  })

  it('mutates progress, watched state, and scrobbles', async () => {
    await request(
      '/:/timeline?ratingKey=101&key=%2Flibrary%2Fmetadata%2F101&state=playing&time=1000&duration=10000',
    )
    expect(mock.state.byRatingKey.get('101')?.viewOffset).toBe(1000)
    await request('/:/timeline?ratingKey=101&key=x&state=stopped&time=9500&duration=10000')
    expect(mock.state.byRatingKey.get('101')).toMatchObject({ viewCount: 1 })
    expect(mock.state.byRatingKey.get('101')?.viewOffset).toBeUndefined()
    await request('/:/scrobble?key=102')
    expect(mock.state.scrobbles).toEqual(['102'])
    await request('/:/unscrobble?key=102')
    expect(mock.state.byRatingKey.get('102')?.viewCount).toBe(0)
  })

  it('selects streams on a part', async () => {
    const part = mock.state.movies[2]!.Media![0]!.Part[0]!
    const audio = part.Stream.find((stream) => stream.streamType === 2)!
    const subtitle = part.Stream.find(
      (stream) => stream.streamType === 3 && stream.codec === 'srt',
    )!
    await request(
      `/library/parts/${part.id}?audioStreamID=${audio.id}&subtitleStreamID=${subtitle.id}`,
      { method: 'PUT' },
    )
    expect(subtitle.selected).toBe(true)
    expect(mock.state.streamSelections[String(part.id)]).toEqual({
      audioStreamID: audio.id,
      subtitleStreamID: subtitle.id,
    })
  })

  it('implements the plex.tv pin lifecycle and resources', async () => {
    const pinResponse = await mock.app.request('http://mock/plextv/api/v2/pins', { method: 'POST' })
    const pin = (await pinResponse.json()) as { id: number; authToken: string | null }
    expect(pin.authToken).toBeNull()
    const unclaimed = (await (
      await mock.app.request(`http://mock/plextv/api/v2/pins/${pin.id}`)
    ).json()) as { authToken: string | null }
    expect(unclaimed.authToken).toBeNull()
    await mock.app.request(`http://mock/plextv/_claim/${pin.id}`, { method: 'POST' })
    const claimed = (await (
      await mock.app.request(`http://mock/plextv/api/v2/pins/${pin.id}`)
    ).json()) as { authToken: string }
    expect(claimed.authToken).toBe('mock-token')
    const resources = (await (
      await mock.app.request('http://mock/plextv/api/v2/resources')
    ).json()) as { connections: unknown[] }[]
    expect(resources[0]?.connections).toHaveLength(2)
  })
})
