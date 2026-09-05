import { Link } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import type { Item } from '@plaguex/plex-api'
import { PlexImage } from './PlexImage'
import { ProgressBar } from './ui'
import { cx, episodeCode, progressFraction } from '@/lib/format'

export type CardShape = 'poster' | 'landscape'

interface Props {
  item: Item
  shape?: CardShape
  /** Landscape cards for episodes show the show title as the primary line. */
  showContext?: boolean
  className?: string
}

export function itemHref(item: Item): {
  to: '/item/$ratingKey' | '/play/$ratingKey'
  params: { ratingKey: string }
} {
  return { to: '/item/$ratingKey', params: { ratingKey: item.ratingKey } }
}

export function cardImage(item: Item, shape: CardShape): string | undefined {
  if (shape === 'landscape') {
    if (item.type === 'episode') return item.thumb ?? item.art ?? item.grandparentArt
    return item.art ?? item.thumb
  }
  if (item.type === 'episode') return item.grandparentThumb ?? item.parentThumb ?? item.thumb
  return item.thumb ?? item.parentThumb ?? item.grandparentThumb
}

export function cardTitle(item: Item, showContext: boolean): { title: string; subtitle: string } {
  if (item.type === 'episode') {
    const code = episodeCode(item.parentIndex, item.index)
    return showContext
      ? { title: item.grandparentTitle ?? item.title, subtitle: `${code} · ${item.title}` }
      : { title: item.title, subtitle: code }
  }
  if (item.type === 'season') return { title: item.parentTitle ?? item.title, subtitle: item.title }
  return { title: item.title, subtitle: item.year ? String(item.year) : '' }
}

export function ItemCard({ item, shape = 'poster', showContext = true, className }: Props) {
  const image = cardImage(item, shape)
  const { title, subtitle } = cardTitle(item, showContext)
  const progress = progressFraction(item.viewOffsetMs, item.durationMs)
  const unwatched =
    item.type === 'movie' || item.type === 'episode'
      ? item.viewCount === 0 && !item.viewOffsetMs
      : false
  const unwatchedCount =
    item.type === 'show' || item.type === 'season'
      ? (item.leafCount ?? 0) - (item.viewedLeafCount ?? 0)
      : 0
  const dims = shape === 'poster' ? { w: 200, h: 300 } : { w: 320, h: 180 }
  return (
    <Link
      {...itemHref(item)}
      className={cx('group block shrink-0 outline-none', className)}
      data-testid="item-card"
      data-rating-key={item.ratingKey}
      aria-label={subtitle ? `${title}, ${subtitle}` : title}
    >
      <div
        className={cx(
          'relative overflow-hidden rounded-card bg-bg-3 ring-accent transition-[transform,box-shadow] duration-200 group-hover:scale-[1.03] group-focus-visible:ring-2',
          shape === 'poster' ? 'aspect-[2/3]' : 'aspect-video',
        )}
      >
        <PlexImage
          path={image}
          width={dims.w}
          height={dims.h}
          className="absolute inset-0 h-full w-full"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-fg">
            <Play className="size-6 fill-current" />
          </span>
        </div>
        {unwatched ? (
          <span
            className="absolute right-2 top-2 size-3 rounded-full bg-accent shadow"
            aria-label="Unwatched"
          />
        ) : null}
        {unwatchedCount > 0 ? (
          <span className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-bold text-accent-fg shadow">
            {unwatchedCount}
          </span>
        ) : null}
        {progress > 0 ? (
          <ProgressBar value={progress} className="absolute inset-x-0 bottom-0 h-1 rounded-none" />
        ) : null}
      </div>
      <div className="mt-2 px-0.5">
        <p className="truncate text-sm font-medium text-fg">{title}</p>
        {subtitle ? <p className="truncate text-xs text-fg-3">{subtitle}</p> : null}
      </div>
    </Link>
  )
}
