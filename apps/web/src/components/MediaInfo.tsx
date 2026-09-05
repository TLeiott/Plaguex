import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Item } from '@plaguex/plex-api'
import { formatBytes, cx } from '@/lib/format'

/** Collapsible technical details: file, codecs, tracks. The stuff Plex hides three menus deep. */
export function MediaInfo({ item }: { item: Item }) {
  const [open, setOpen] = useState(false)
  if (item.media.length === 0) return null
  return (
    <section className="max-w-3xl">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-fg-3 hover:text-fg-2"
        aria-expanded={open}
      >
        Media info{' '}
        <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="mt-3 flex flex-col gap-4 text-sm">
          {item.media.map((m, i) => (
            <div key={m.id} className="rounded-card border border-line bg-bg-2 p-3">
              <p className="mb-2 font-medium">
                Version {i + 1}: {m.videoResolution?.toUpperCase()} {m.videoCodec?.toUpperCase()} ·{' '}
                {m.audioCodec?.toUpperCase()} {m.audioChannels ? `${m.audioChannels}ch` : ''} ·{' '}
                {m.container?.toUpperCase()} ·{' '}
                {m.bitrate ? `${Math.round((m.bitrate / 1000) * 10) / 10} Mbps` : ''}
              </p>
              {m.parts.map((p) => (
                <div key={p.id} className="flex flex-col gap-1">
                  {p.file ? (
                    <p className="break-all font-mono text-xs text-fg-3">
                      {p.file}
                      {p.size ? ` (${formatBytes(p.size)})` : ''}
                    </p>
                  ) : null}
                  <ul className="mt-1 grid gap-0.5">
                    {p.streams.map((s) => (
                      <li key={s.id} className="flex gap-2 text-fg-2">
                        <span className="w-16 shrink-0 text-fg-3">{s.kind}</span>
                        <span>{s.displayTitle}</span>
                        {s.external ? <span className="text-fg-3">(external)</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
