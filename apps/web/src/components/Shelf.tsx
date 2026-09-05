import { useRef, type ReactNode } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Item } from '@plaguex/plex-api'
import { ItemCard, type CardShape } from './ItemCard'
import { Button } from './ui'
import { cx } from '@/lib/format'

interface Props {
  title: string
  items: Item[]
  shape?: CardShape
  action?: ReactNode
  showContext?: boolean
  /** Makes the title a link (e.g. to the full library listing). */
  link?: Pick<LinkProps, 'to' | 'params' | 'search'>
}

/** Horizontal, scroll-snapping row of cards with keyboard-friendly paging buttons. */
export function Shelf({ title, items, shape = 'poster', action, showContext, link }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  if (items.length === 0) return null
  const page = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' })
  }
  return (
    <section className="group/shelf" aria-label={title} data-testid="shelf">
      <div className="mb-3 flex items-center justify-between safe-px">
        {link ? (
          <Link
            {...link}
            className="group/title inline-flex items-center gap-1 text-lg font-semibold tracking-tight hover:text-accent"
            data-testid="shelf-title-link"
          >
            {title}
            <ChevronRight className="size-5 opacity-60 transition-transform group-hover/title:translate-x-0.5" />
          </Link>
        ) : (
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        )}
        <div className="flex items-center gap-1">
          {action}
          <Button
            size="icon"
            variant="ghost"
            className="hidden h-8 w-8 md:inline-flex"
            aria-label={`Scroll ${title} left`}
            onClick={() => page(-1)}
          >
            <ChevronLeft className="size-5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="hidden h-8 w-8 md:inline-flex"
            aria-label={`Scroll ${title} right`}
            onClick={() => page(1)}
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>
      <div
        ref={ref}
        className={cx(
          'flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 scrollbar-none md:gap-4 md:scroll-px-6 md:px-6',
        )}
      >
        {items.map((item) => (
          <ItemCard
            key={item.ratingKey}
            item={item}
            shape={shape}
            {...(showContext !== undefined ? { showContext } : {})}
            className={cx(
              'snap-start',
              shape === 'poster'
                ? 'w-[120px] sm:w-[140px] md:w-[160px] lg:w-[180px]'
                : 'w-[220px] sm:w-[260px] md:w-[300px]',
            )}
          />
        ))}
      </div>
    </section>
  )
}
