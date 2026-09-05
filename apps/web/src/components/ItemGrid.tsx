import type { Item } from '@plaguex/plex-api'
import { ItemCard, type CardShape } from './ItemCard'

export function ItemGrid({
  items,
  shape = 'poster',
  showContext,
}: {
  items: Item[]
  shape?: CardShape
  showContext?: boolean
}) {
  return (
    <div
      className={
        shape === 'poster'
          ? 'grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] md:gap-4'
          : 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 md:gap-4'
      }
      data-testid="item-grid"
    >
      {items.map((item) => (
        <ItemCard
          key={item.ratingKey}
          item={item}
          shape={shape}
          {...(showContext !== undefined ? { showContext } : {})}
        />
      ))}
    </div>
  )
}
