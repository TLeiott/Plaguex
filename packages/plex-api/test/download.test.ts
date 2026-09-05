import { describe, expect, it } from 'vitest'
import type { Item } from '../src/types'
import {
  DOWNLOAD_PRESETS,
  estimateDownloadBytes,
  estimateTranscodeBytes,
  presetsFor,
  transcodeDownloadUrl,
} from '../src/download'

const client = {
  clientIdentifier: 'cid',
  product: 'Plaguex',
  version: '1',
  platform: 'Chrome',
  device: 'Linux',
  deviceName: 'test',
}
const item: Item = {
  ratingKey: '42',
  key: '/library/metadata/42',
  type: 'movie',
  title: 'Movie',
  viewCount: 0,
  durationMs: 2 * 60 * 60 * 1000,
  media: [
    {
      id: 1,
      height: 2160,
      parts: [{ id: 7, key: '/library/parts/7/1/file.mkv', size: 20_000_000_000, streams: [] }],
    },
  ],
  genres: [],
  directors: [],
  writers: [],
  roles: [],
  markers: [],
  chapters: [],
}

describe('presetsFor', () => {
  it('never offers a preset taller than the source', () => {
    expect(presetsFor({ id: 1, height: 1080, parts: [] }).every((p) => p.height <= 1080)).toBe(true)
    expect(presetsFor({ id: 1, height: 300, parts: [] })).toEqual([
      DOWNLOAD_PRESETS[DOWNLOAD_PRESETS.length - 1],
    ])
    expect(presetsFor(undefined)).toEqual([...DOWNLOAD_PRESETS])
  })
})

describe('estimates', () => {
  it('estimates transcode size from bitrate and runtime', () => {
    const p = DOWNLOAD_PRESETS.find((x) => x.id === '1080p-8')!
    // (8000 + 128) kbps * 7200 s / 8 = 7.3 GB
    expect(estimateTranscodeBytes(item.durationMs, p)).toBe(7_315_200_000)
    expect(estimateTranscodeBytes(undefined, p)).toBeNull()
  })
  it('uses the part size for originals', () => {
    expect(estimateDownloadBytes(item, { kind: 'original', mediaIndex: 0 })).toBe(20_000_000_000)
  })
})

describe('transcodeDownloadUrl', () => {
  it('builds a progressive http transcode request', () => {
    const p = DOWNLOAD_PRESETS.find((x) => x.id === '720p-2')!
    const url = new URL(
      transcodeDownloadUrl({
        baseUrl: 'http://s',
        token: 't',
        client,
        item,
        mediaIndex: 0,
        preset: p,
        sessionId: 'sess',
      }),
    )
    expect(url.pathname).toBe('/video/:/transcode/universal/start.mp4')
    expect(url.searchParams.get('protocol')).toBe('http')
    expect(url.searchParams.get('videoResolution')).toBe('1280x720')
    expect(url.searchParams.get('maxVideoBitrate')).toBe('2000')
    expect(url.searchParams.get('directPlay')).toBe('0')
    expect(url.searchParams.get('X-Plex-Token')).toBe('t')
    expect(url.searchParams.get('X-Plex-Client-Profile-Extra')).toContain('protocol=http')
  })
})
