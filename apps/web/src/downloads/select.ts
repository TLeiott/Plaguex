import type { Item } from '@plaguex/plex-api'

/** Items that can actually be downloaded: playable leaves (movies/episodes) with a media part. */
export function downloadable(items: Item[]): Item[] {
  return items.filter(
    (i) => (i.type === 'movie' || i.type === 'episode') && i.media.some((m) => m.parts.length > 0),
  )
}

export type DownloadSummary = { total: number; done: number; active: number }

export function summarize(
  items: Item[],
  entries: Record<string, { status: string } | undefined>,
): DownloadSummary {
  const leaves = downloadable(items)
  let done = 0
  let active = 0
  for (const i of leaves) {
    const e = entries[i.ratingKey]
    if (!e) continue
    if (e.status === 'done') done++
    else if (e.status !== 'error') active++
  }
  return { total: leaves.length, done, active }
}
