import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Check, Download, Loader2 } from 'lucide-react'
import type { Item } from '@plaguex/plex-api'
import { q } from '@/plex/queries'
import { useDownloads } from '@/downloads/store'
import { downloadable, summarize } from '@/downloads/select'
import { isTauri } from '@/platform'
import { Button } from './ui'

interface Props {
  /** A movie/episode, or a show/season whose leaves get queued. */
  item: Item
  size?: 'sm' | 'md' | 'icon'
  className?: string
}

/**
 * Queues the item (or every episode of a show/season) for offline playback. Only rendered inside
 * the native shells: browsers cannot store multi-gigabyte files reliably.
 */
export function DownloadButton({ item, size = 'md', className }: Props) {
  const qc = useQueryClient()
  const entries = useDownloads((s) => s.items)
  const startMany = useDownloads((s) => s.startMany)
  const [busy, setBusy] = useState(false)
  if (!isTauri()) return null

  const isContainer = item.type === 'show' || item.type === 'season'
  const known = isContainer ? undefined : entries[item.ratingKey]
  const label = isContainer
    ? item.type === 'show'
      ? 'Download series'
      : 'Download season'
    : 'Download'

  const start = async () => {
    setBusy(true)
    try {
      const leaves = isContainer
        ? await qc.fetchQuery(
            item.type === 'show' ? q.allEpisodes(item.ratingKey) : q.children(item.ratingKey),
          )
        : [item]
      await startMany(downloadable(leaves).filter((l) => entries[l.ratingKey]?.status !== 'done'))
    } finally {
      setBusy(false)
    }
  }

  const iconOnly = size === 'icon'
  if (known?.status === 'done') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-sm text-accent ${className ?? ''}`}
        data-testid="download-done"
        aria-label="Downloaded"
      >
        <Check className="size-4" /> {iconOnly ? null : 'Downloaded'}
      </span>
    )
  }
  if (known && known.status !== 'error') {
    const pct = known.totalBytes ? Math.round((known.receivedBytes / known.totalBytes) * 100) : null
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-sm text-fg-2 ${className ?? ''}`}
        data-testid="download-active"
        aria-label="Downloading"
      >
        <Loader2 className="size-4 animate-spin" />{' '}
        {iconOnly ? null : pct !== null ? `${pct}%` : 'Queued'}
      </span>
    )
  }
  return (
    <Button
      variant="ghost"
      size={size}
      onClick={() => void start()}
      loading={busy}
      aria-label={label}
      title={label}
      data-testid="download"
      {...(className ? { className } : {})}
    >
      {busy ? null : <Download className="size-5" />}
      {iconOnly ? null : label}
    </Button>
  )
}

/** Compact "3/10 downloaded" indicator for show/season headers. */
export function DownloadSummaryBadge({ items }: { items: Item[] }) {
  const entries = useDownloads((s) => s.items)
  if (!isTauri()) return null
  const s = summarize(items, entries)
  if (s.done === 0 && s.active === 0) return null
  return (
    <span className="text-xs text-fg-3" data-testid="download-summary">
      {s.done}/{s.total} downloaded{s.active ? ` · ${s.active} in progress` : ''}
    </span>
  )
}
