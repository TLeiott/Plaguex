import { describe, expect, it } from 'vitest'
import type { Item } from '@plaguex/plex-api'
import { downloadable, summarize } from './select'

const item = (ratingKey: string, type: Item['type'], parts = 1): Item => ({
  ratingKey,
  key: `/library/metadata/${ratingKey}`,
  type,
  title: ratingKey,
  viewCount: 0,
  media: [
    {
      id: 1,
      parts: Array.from({ length: parts }, (_, i) => ({ id: i, key: `/p/${i}`, streams: [] })),
    },
  ],
  genres: [],
  directors: [],
  writers: [],
  roles: [],
  markers: [],
  chapters: [],
})

describe('downloadable', () => {
  it('keeps movies and episodes with parts, drops containers and part-less items', () => {
    const out = downloadable([
      item('1', 'movie'),
      item('2', 'show'),
      item('3', 'season'),
      item('4', 'episode'),
      item('5', 'episode', 0),
    ])
    expect(out.map((i) => i.ratingKey)).toEqual(['1', '4'])
  })
})

describe('summarize', () => {
  it('counts done and active leaves', () => {
    const items = [
      item('1', 'episode'),
      item('2', 'episode'),
      item('3', 'episode'),
      item('4', 'episode'),
    ]
    const s = summarize(items, {
      '1': { status: 'done' },
      '2': { status: 'downloading' },
      '3': { status: 'error' },
    })
    expect(s).toEqual({ total: 4, done: 1, active: 1 })
  })
})
