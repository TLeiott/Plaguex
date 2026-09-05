import { Link } from '@tanstack/react-router'
import { Play, Info } from 'lucide-react'
import type { Item } from '@plaguex/plex-api'
import { PlexImage } from './PlexImage'
import { buttonClass, ProgressBar } from './ui'
import { episodeCode, formatDuration, progressFraction } from '@/lib/format'

/** Big "resume" banner for the first Continue Watching item. */
export function Hero({ item }: { item: Item }) {
  const art = item.art ?? item.grandparentArt
  const title = item.type === 'episode' ? (item.grandparentTitle ?? item.title) : item.title
  const sub =
    item.type === 'episode'
      ? `${episodeCode(item.parentIndex, item.index)} · ${item.title}`
      : [item.year, formatDuration(item.durationMs)].filter(Boolean).join(' · ')
  const progress = progressFraction(item.viewOffsetMs, item.durationMs)
  const remaining =
    item.durationMs && item.viewOffsetMs
      ? formatDuration(item.durationMs - item.viewOffsetMs, { compact: true })
      : ''
  return (
    <section
      className="relative isolate h-[34vh] min-h-[240px] w-full overflow-hidden md:h-[52vh]"
      aria-label="Resume playback"
      data-testid="hero"
    >
      <PlexImage path={art} width={1280} height={720} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-bg/80 via-transparent to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-6 safe-px md:p-10">
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight drop-shadow md:text-5xl">
          {title}
        </h1>
        <p className="text-sm text-fg-2 md:text-base">{sub}</p>
        <div className="mt-1 flex items-center gap-3">
          <Link
            to="/play/$ratingKey"
            params={{ ratingKey: item.ratingKey }}
            className={buttonClass('primary', 'lg')}
            data-testid="hero-play"
          >
            <Play className="size-5 fill-current" /> {progress > 0 ? 'Resume' : 'Play'}
          </Link>
          <Link
            to="/item/$ratingKey"
            params={{ ratingKey: item.ratingKey }}
            className={buttonClass('secondary', 'lg')}
          >
            <Info className="size-5" /> Details
          </Link>
          {remaining ? <span className="text-sm text-fg-2">{remaining} left</span> : null}
        </div>
        {progress > 0 ? <ProgressBar value={progress} className="mt-1 max-w-md" /> : null}
      </div>
    </section>
  )
}
