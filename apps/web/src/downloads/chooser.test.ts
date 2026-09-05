import { describe, expect, it } from 'vitest'
import type { Item } from '@plaguex/plex-api'
import { chooserOptions, choiceFromSetting } from './chooser'

const ep = (rk: string, height: number, size: number, durationMin: number): Item => ({
  ratingKey: rk,
  key: '',
  type: 'episode',
  title: rk,
  viewCount: 0,
  durationMs: durationMin * 60_000,
  media: [
    {
      id: 1,
      height,
      videoCodec: 'hevc',
      audioCodec: 'eac3',
      container: 'mkv',
      parts: [{ id: 1, key: '/p/1/file.mkv', size, streams: [] }],
    },
  ],
  genres: [],
  directors: [],
  writers: [],
  roles: [],
  markers: [],
  chapters: [],
})

describe('chooserOptions', () => {
  it('offers the original plus presets no taller than the source, with summed sizes', () => {
    const opts = chooserOptions([
      ep('1', 2160, 5_000_000_000, 60),
      ep('2', 2160, 6_000_000_000, 60),
    ])
    expect(opts[0]).toMatchObject({
      id: 'original-0',
      bytes: 11_000_000_000,
      detail: '4K · HEVC · EAC3 · MKV',
    })
    expect(opts.map((o) => o.id)).toContain('1440p-12')
    const p1080 = opts.find((o) => o.id === '1080p-8')!
    // (8000+128) kbps * 3600 s / 8 * 2 episodes
    expect(p1080.bytes).toBe(7_315_200_000)
  })
  it('does not offer 4K or 1440p presets for a 1080p source', () => {
    const ids = chooserOptions([ep('1', 1080, 1, 10)]).map((o) => o.id)
    expect(ids).not.toContain('2160p-20')
    expect(ids).not.toContain('1440p-12')
    expect(ids).toContain('1080p-8')
  })
})

describe('choiceFromSetting', () => {
  const items = [ep('1', 1080, 1, 10)]
  it('maps settings to choices', () => {
    expect(choiceFromSetting('ask', items)).toBeNull()
    expect(choiceFromSetting('original', items)).toEqual({ kind: 'original', mediaIndex: 0 })
    expect(choiceFromSetting('720p-2', items)).toMatchObject({
      kind: 'transcode',
      preset: { id: '720p-2' },
    })
    expect(choiceFromSetting('bogus', items)).toBeNull()
  })
})
