import { describe, expect, it } from 'vitest'
import type { MediaPart, MediaStream } from '@plaguex/plex-api'
import { externalSubtitleOrdinal, trackOrdinal } from './external'

const stream = (id: number, kind: MediaStream['kind'], external = false): MediaStream => ({
  id,
  kind,
  displayTitle: `${kind} ${id}`,
  selected: false,
  default: false,
  forced: false,
  external,
})

const part: MediaPart = {
  id: 1,
  key: '/library/parts/1/1/file.mkv',
  streams: [
    stream(10, 'video'),
    stream(20, 'audio'),
    stream(21, 'audio'),
    stream(30, 'subtitle'),
    stream(31, 'subtitle', true),
    stream(32, 'subtitle'),
  ],
}

describe('trackOrdinal', () => {
  it('numbers audio tracks from 1 in Plex order', () => {
    expect(trackOrdinal(part, 20)).toBe(1)
    expect(trackOrdinal(part, 21)).toBe(2)
  })
  it('skips external subtitles when numbering embedded ones', () => {
    expect(trackOrdinal(part, 30)).toBe(1)
    expect(trackOrdinal(part, 32)).toBe(2)
  })
  it('returns undefined for video or unknown ids', () => {
    expect(trackOrdinal(part, 10)).toBeUndefined()
    expect(trackOrdinal(part, 999)).toBeUndefined()
  })
})

describe('externalSubtitleOrdinal', () => {
  it('places external files after the embedded subtitle tracks', () => {
    expect(externalSubtitleOrdinal(part, 31)).toBe(3)
    expect(externalSubtitleOrdinal(part, 30)).toBeUndefined()
  })
})
