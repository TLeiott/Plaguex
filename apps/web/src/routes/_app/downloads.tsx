import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Pause, Play, Trash2, Download } from 'lucide-react'
import { useDownloads, wireDownloadEvents } from '@/downloads/store'
import { Button, EmptyState, ProgressBar } from '@/components/ui'
import { cardTitle } from '@/components/ItemCard'
import { formatBytes } from '@/lib/format'
import { isTauri } from '@/platform'

export const Route = createFileRoute('/_app/downloads')({ component: DownloadsPage })

function DownloadsPage() {
  const { items, pause, resume, remove } = useDownloads()
  useEffect(() => {
    if (isTauri()) wireDownloadEvents()
  }, [])
  const list = Object.values(items)
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
      ) : list.length === 0 ? (
        <EmptyState title="Nothing downloaded yet" icon={<Download className="size-10" />}>
          Open a movie or episode and press Download.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-bg-2">
          {list.map((d) => {
            const { title, subtitle } = cardTitle(d.item, true)
            const frac = d.totalBytes ? d.receivedBytes / d.totalBytes : 0
            return (
              <li key={d.id} className="flex items-center gap-4 p-4" data-testid="download-item">
                <div className="min-w-0 flex-1">
                  <Link
                    to="/item/$ratingKey"
                    params={{ ratingKey: d.item.ratingKey }}
                    className="truncate font-medium hover:underline"
                  >
                    {title}
                  </Link>
                  <p className="truncate text-xs text-fg-3">{subtitle}</p>
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
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Resume"
                    onClick={() => void resume(d.id)}
                  >
                    <Play className="size-5" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Pause"
                    onClick={() => void pause(d.id)}
                  >
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
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
