import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import { Pause, Play, Trash2, Download, ChevronDown } from 'lucide-react'
import { useDownloads, wireDownloadEvents, type DownloadEntry } from '@/downloads/store'
import { groupDownloads } from '@/downloads/group'
import { Button, EmptyState, ProgressBar } from '@/components/ui'
import { cardTitle } from '@/components/ItemCard'
import { episodeCode, formatBytes } from '@/lib/format'
import { isTauri } from '@/platform'

export const Route = createFileRoute('/_app/downloads')({ component: DownloadsPage })

function DownloadsPage() {
  const { items, pause, resume, remove } = useDownloads()
  useEffect(() => {
    if (isTauri()) wireDownloadEvents()
  }, [])
  const groups = useMemo(() => groupDownloads(Object.values(items)), [items])
  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6 safe-px"
      data-testid="downloads-page"
    >
      <h1 className="text-2xl font-bold tracking-tight">Downloads</h1>
      {!isTauri() ? (
        <EmptyState
          title="Downloads need the desktop or Android app"
          icon={<Download className="size-10" />}
        >
          The browser cannot store multi-gigabyte files reliably. Install Plaguex for Linux or
          Android to download for offline playback.
        </EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState title="Nothing downloaded yet" icon={<Download className="size-10" />}>
          Open a movie, episode, season or show and press Download.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const single = !g.subtitle && g.entries.length === 1 && g.entries[0]
            if (single)
              return <Row key={g.key} d={single} pause={pause} resume={resume} remove={remove} />
            const frac = g.totalBytes ? g.receivedBytes / g.totalBytes : 0
            return (
              <details
                key={g.key}
                className="group rounded-card border border-line bg-bg-2"
                data-testid="download-group"
                open={g.done < g.entries.length}
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                  <ChevronDown className="size-5 shrink-0 text-fg-3 transition-transform group-open:rotate-180" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {g.title} <span className="text-fg-3">· {g.subtitle}</span>
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-fg-2">
                      <ProgressBar
                        value={g.done === g.entries.length ? 1 : frac}
                        className="max-w-xs"
                      />
                      <span>
                        {g.done}/{g.entries.length} episodes · {formatBytes(g.receivedBytes)}
                        {g.totalBytes ? ` / ${formatBytes(g.totalBytes)}` : ''}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${g.title} ${g.subtitle ?? ''}`}
                    onClick={(e) => {
                      e.preventDefault()
                      for (const d of g.entries) void remove(d.id)
                    }}
                  >
                    <Trash2 className="size-5" />
                  </Button>
                </summary>
                <ul className="divide-y divide-line border-t border-line">
                  {g.entries.map((d) => (
                    <Row key={d.id} d={d} pause={pause} resume={resume} remove={remove} compact />
                  ))}
                </ul>
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Row({
  d,
  pause,
  resume,
  remove,
  compact,
}: {
  d: DownloadEntry
  pause: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  compact?: boolean
}) {
  const { title, subtitle } = cardTitle(d.item, true)
  const label =
    compact && d.item.type === 'episode'
      ? `${episodeCode(d.item.parentIndex, d.item.index)} · ${d.item.title}`
      : title
  const frac = d.totalBytes ? d.receivedBytes / d.totalBytes : 0
  const Wrapper = compact ? 'li' : 'div'
  return (
    <Wrapper
      className={
        compact
          ? 'flex items-center gap-4 px-4 py-3'
          : 'flex items-center gap-4 rounded-card border border-line bg-bg-2 p-4'
      }
      data-testid="download-item"
    >
      <div className="min-w-0 flex-1">
        <Link
          to="/item/$ratingKey"
          params={{ ratingKey: d.item.ratingKey }}
          className="truncate font-medium hover:underline"
        >
          {label}
        </Link>
        {!compact && subtitle ? <p className="truncate text-xs text-fg-3">{subtitle}</p> : null}
        <div className="mt-2 flex items-center gap-3 text-xs text-fg-2">
          <ProgressBar value={d.status === 'done' ? 1 : frac} className="max-w-xs" />
          <span>
            {d.status === 'done'
              ? formatBytes(d.totalBytes)
              : `${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes) || '?'}`}{' '}
            · {d.status}
          </span>
        </div>
        {d.error ? <p className="mt-1 text-xs text-danger">{d.error}</p> : null}
      </div>
      {d.status === 'done' ? (
        <Link
          to="/play/$ratingKey"
          params={{ ratingKey: d.item.ratingKey }}
          search={{ offline: true }}
          className="rounded-lg bg-accent p-2 text-accent-fg"
          aria-label="Play offline"
        >
          <Play className="size-5 fill-current" />
        </Link>
      ) : d.status === 'paused' || d.status === 'error' ? (
        <Button size="icon" variant="ghost" aria-label="Resume" onClick={() => void resume(d.id)}>
          <Play className="size-5" />
        </Button>
      ) : (
        <Button size="icon" variant="ghost" aria-label="Pause" onClick={() => void pause(d.id)}>
          <Pause className="size-5" />
        </Button>
      )}
      <Button
        size="icon"
        variant="ghost"
        aria-label="Remove download"
        onClick={() => void remove(d.id)}
      >
        <Trash2 className="size-5" />
      </Button>
    </Wrapper>
  )
}
