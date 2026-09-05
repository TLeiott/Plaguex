import { describe, expect, it } from 'vitest'
import type { Item } from '@plaguex/plex-api'
import { groupDownloads } from './group'
import type { DownloadEntry } from './store'

const base = (over: Partial<Item>): Item => ({
  ratingKey: 'x',
  key: '',
  type: 'movie',
  title: 'x',
  viewCount: 0,
  media: [],
  genres: [],
  directors: [],
  writers: [],
  roles: [],
  markers: [],
  chapters: [],
  ...over,
})
const entry = (
  item: Item,
  status: DownloadEntry['status'],
  received = 0,
  total: number | null = 100,
): DownloadEntry => ({
  id: item.ratingKey,
  item,
  serverId: 's',
  fileName: 'f',
  receivedBytes: received,
  totalBytes: total,
  status,
})

describe('groupDownloads', () => {
  it('groups episodes by show and season, movies alone, sorted by title', () => {
    const e1 = entry(
      base({
        ratingKey: '1',
        type: 'episode',
        grandparentRatingKey: '9',
        grandparentTitle: 'Zeta Show',
        parentIndex: 1,
        index: 2,
      }),
      'done',
      100,
    )
    const e2 = entry(
      base({
        ratingKey: '2',
        type: 'episode',
        grandparentRatingKey: '9',
        grandparentTitle: 'Zeta Show',
        parentIndex: 1,
        index: 1,
      }),
      'downloading',
      40,
    )
    const e3 = entry(
      base({
        ratingKey: '3',
        type: 'episode',
        grandparentRatingKey: '9',
        grandparentTitle: 'Zeta Show',
        parentIndex: 2,
        index: 1,
      }),
      'queued',
    )
    const m = entry(base({ ratingKey: '4', type: 'movie', title: 'Alpha Movie' }), 'done', 100)
    const groups = groupDownloads([e1, e2, e3, m])
    expect(groups.map((g) => [g.title, g.subtitle, g.entries.length])).toEqual([
      ['Alpha Movie', undefined, 1],
      ['Zeta Show', 'Season 1', 2],
      ['Zeta Show', 'Season 2', 1],
    ])
    const s1 = groups[1]!
    expect(s1.entries.map((e) => e.item.index)).toEqual([1, 2])
    expect(s1.done).toBe(1)
    expect(s1.receivedBytes).toBe(140)
    expect(s1.totalBytes).toBe(200)
  })
})
