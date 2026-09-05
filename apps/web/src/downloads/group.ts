import type { DownloadEntry } from './store'

export interface DownloadGroup {
  /** Stable key for React and collapsing state. */
  key: string
  /** Show title, or the movie title for single movies. */
  title: string
  /** e.g. "Season 1"; undefined for movies. */
  subtitle?: string
  entries: DownloadEntry[]
  done: number
  receivedBytes: number
  totalBytes: number
}

/**
 * Group downloads for the Downloads page: episodes by show and season (newest season first),
 * movies as single-entry groups, sorted by title.
 */
export function groupDownloads(entries: DownloadEntry[]): DownloadGroup[] {
  const groups = new Map<string, DownloadGroup>()
  for (const e of entries) {
    const it = e.item
    const isEpisode = it.type === 'episode'
    const key = isEpisode
      ? `show:${it.grandparentRatingKey ?? it.grandparentTitle ?? '?'}:s${it.parentIndex ?? 0}`
      : `movie:${it.ratingKey}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        title: isEpisode ? (it.grandparentTitle ?? 'Unknown show') : it.title,
        ...(isEpisode
          ? {
              subtitle:
                it.parentIndex !== undefined
                  ? `Season ${it.parentIndex}`
                  : (it.parentTitle ?? 'Episodes'),
            }
          : {}),
        entries: [],
        done: 0,
        receivedBytes: 0,
        totalBytes: 0,
      }
      groups.set(key, g)
    }
    g.entries.push(e)
    if (e.status === 'done') g.done++
    g.receivedBytes += e.status === 'done' ? (e.totalBytes ?? e.receivedBytes) : e.receivedBytes
    g.totalBytes += e.totalBytes ?? 0
  }
  for (const g of groups.values()) {
    g.entries.sort((a, b) => (a.item.index ?? 0) - (b.item.index ?? 0))
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.title.localeCompare(b.title) ||
      (a.subtitle ?? '').localeCompare(b.subtitle ?? '', undefined, { numeric: true }),
  )
}
