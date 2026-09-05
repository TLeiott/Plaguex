import { describe, expect, it } from 'vitest'
import {
  normalizeHub,
  normalizeItem,
  normalizeLibrary,
  normalizeResource,
  normalizeStream,
  normalizeUser,
} from '../src/normalize'
import type { RawMetadata, RawResource, RawStream } from '../src/raw'

const metadata = (overrides: Partial<RawMetadata> = {}): RawMetadata => ({
  ratingKey: '7',
  key: '/library/metadata/7',
  type: 'movie',
  title: 'Arrival',
  ...overrides,
})

describe('normalizers', () => {
  it('normalizes nested movie media, markers, chapters, tags, and HDR streams', () => {
    const item = normalizeItem(
      metadata({
        librarySectionID: 4,
        viewCount: 2,
        Genre: [{ id: 1, tag: 'Sci-Fi' }],
        Marker: [{ type: 'credits', startTimeOffset: 100, endTimeOffset: 200, final: true }],
        Chapter: [
          { index: 1, startTimeOffset: 0, endTimeOffset: 100, tag: 'Opening', thumb: '/chapter' },
        ],
        Media: [
          {
            id: 10,
            height: 2160,
            videoCodec: 'hevc',
            Part: [
              {
                id: 11,
                key: '/part',
                container: 'mkv',
                Stream: [
                  { id: 1, streamType: 1, codec: 'hevc', DOVIPresent: true },
                  { id: 2, streamType: 1, colorTrc: 'smpte2084' },
                  { id: 3, streamType: 1, colorTrc: 'arib-std-b67' },
                  { id: 4, streamType: 2, codec: 'aac' },
                ],
              },
            ],
          },
        ],
      }),
    )
    expect(item).toMatchObject({
      type: 'movie',
      libraryId: '4',
      viewCount: 2,
      genres: [{ id: 1, tag: 'Sci-Fi' }],
    })
    expect(item.media[0]?.parts[0]?.streams.map((stream) => stream.hdr)).toEqual([
      'dolby-vision',
      'hdr10',
      'hlg',
      undefined,
    ])
    expect(item.markers).toEqual([{ type: 'credits', startMs: 100, endMs: 200, final: true }])
    expect(item.chapters).toEqual([
      { index: 1, startMs: 0, endMs: 100, title: 'Opening', thumb: '/chapter' },
    ])
  })

  it('omits absent optional fields and maps unknown item types', () => {
    const item = normalizeItem(metadata({ type: 'podcast' }))
    expect(item.type).toBe('unknown')
    expect(item).not.toHaveProperty('summary')
    expect(item).not.toHaveProperty('durationMs')
  })

  it.each<[RawStream, string, string]>([
    [{ id: 1, streamType: 1, extendedDisplayTitle: 'Extended' }, 'video', 'Extended'],
    [{ id: 2, streamType: 2, displayTitle: 'Displayed' }, 'audio', 'Displayed'],
    [{ id: 3, streamType: 3, title: 'Director notes', key: '/sub' }, 'subtitle', 'Director notes'],
    [{ id: 4, streamType: 4, language: 'Deutsch' }, 'lyrics', 'Deutsch'],
    [{ id: 5, streamType: 2 }, 'audio', 'Stream 5'],
  ])('normalizes stream %#', (raw, kind, title) => {
    expect(normalizeStream(raw)).toMatchObject({
      kind,
      displayTitle: title,
      external: Boolean(raw.key),
    })
  })

  it('normalizes libraries and hubs', () => {
    expect(normalizeLibrary({ key: '1', title: 'Films', type: 'movie', uuid: 'u' })).toEqual({
      id: '1',
      title: 'Films',
      type: 'movie',
      uuid: 'u',
    })
    expect(normalizeLibrary({ key: '2', title: 'Other', type: 'book' }).type).toBe('unknown')
    expect(
      normalizeHub({
        hubIdentifier: 'recent',
        hubKey: '/hub',
        title: 'Recent',
        type: 'movie',
        size: 1,
        more: true,
        Metadata: [metadata()],
      }),
    ).toMatchObject({
      identifier: 'recent',
      key: '/hub',
      more: true,
      items: [{ title: 'Arrival' }],
    })
  })

  it('normalizes resources and users', () => {
    const resource: RawResource = {
      name: 'Server',
      product: 'Plex Media Server',
      productVersion: '1',
      platform: 'Linux',
      clientIdentifier: 'machine',
      createdAt: '',
      lastSeenAt: '',
      provides: 'server',
      owned: true,
      accessToken: 'server-token',
      httpsRequired: true,
      presence: true,
      connections: [
        {
          protocol: 'https',
          address: 'host',
          port: 32400,
          uri: 'https://host:32400',
          local: true,
          relay: false,
          IPv6: false,
        },
      ],
    }
    expect(normalizeResource(resource)).toMatchObject({
      name: 'Server',
      platform: 'Linux',
      connections: [{ local: true, relay: false }],
    })
    expect(
      normalizeUser({
        id: 1,
        uuid: 'u',
        username: 'tim',
        title: 'Tim',
        subscription: { active: true },
      }),
    ).toMatchObject({ plexPass: true })
    expect(normalizeUser({ id: 2, uuid: 'v', username: 'guest', title: 'Guest' }).plexPass).toBe(
      false,
    )
  })
})
