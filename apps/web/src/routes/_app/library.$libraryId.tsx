import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { activeServer } from '@/plex/api'
import { q } from '@/plex/queries'
import { useSession } from '@/plex/session'
import { ItemGrid } from '@/components/ItemGrid'
import { Shelf } from '@/components/Shelf'
import { PageSpinner, ErrorState, EmptyState, Spinner } from '@/components/ui'
import { cx } from '@/lib/format'

const PAGE = 60
const SORTS = [
  { id: 'titleSort:asc', label: 'Title' },
  { id: 'addedAt:desc', label: 'Recently added' },
  { id: 'originallyAvailableAt:desc', label: 'Release date' },
  { id: 'rating:desc', label: 'Rating' },
  { id: 'lastViewedAt:desc', label: 'Last watched' },
] as const

const searchSchema = z.object({
  sort: z.string().optional(),
  unwatched: z.boolean().optional(),
  view: z.enum(['recommended', 'all']).optional(),
})

export const Route = createFileRoute('/_app/library/$libraryId')({
  validateSearch: searchSchema,
  component: LibraryPage,
})

function LibraryPage() {
  const { libraryId } = Route.useParams()
  const { sort = 'titleSort:asc', unwatched = false, view = 'recommended' } = Route.useSearch()
  const libraries = useQuery(q.libraries())
  const library = libraries.data?.find((l) => l.id === libraryId)
  const serverKey = useSession((s) => s.activeServer?.clientIdentifier)
  const nav = useNavigate()
  const navigate = (s: { libraryId: string; sort: string; unwatched: boolean }) =>
    nav({
      to: '/library/$libraryId',
      params: { libraryId: s.libraryId },
      search: { view: 'all', sort: s.sort, unwatched: s.unwatched },
      replace: true,
    })

  const hubs = useQuery({ ...q.libraryHubs(libraryId), enabled: view === 'recommended' })
  const all = useInfiniteQuery({
    queryKey: [serverKey, 'libraryAll', libraryId, sort, unwatched],
    queryFn: ({ pageParam }) =>
      activeServer().libraryItems(libraryId, {
        offset: pageParam,
        limit: PAGE,
        sort,
        ...(unwatched ? { filters: { unwatched: 1 } } : {}),
      }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined,
    enabled: view === 'all',
  })

  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || view !== 'all') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && all.hasNextPage && !all.isFetchingNextPage)
          void all.fetchNextPage()
      },
      { rootMargin: '800px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [view, all, all.hasNextPage, all.isFetchingNextPage])

  const items = all.data?.pages.flatMap((p) => p.items) ?? []
  const total = all.data?.pages[0]?.total

  const tabCls = (active: boolean) =>
    cx(
      'rounded-full px-3 py-1.5 text-sm transition-colors',
      active ? 'bg-fg text-bg font-semibold' : 'text-fg-2 hover:bg-bg-3 hover:text-fg',
    )

  return (
    <div className="flex flex-col gap-6 py-6" data-testid="library-page">
      <header className="flex flex-wrap items-center gap-3 safe-px md:px-6">
        <h1 className="mr-auto text-2xl font-bold tracking-tight">{library?.title ?? 'Library'}</h1>
        <div className="flex items-center gap-1 rounded-full bg-bg-2 p-1" role="tablist">
          <Link
            to="/library/$libraryId"
            params={{ libraryId }}
            search={{ view: 'recommended' }}
            className={tabCls(view === 'recommended')}
            role="tab"
            aria-selected={view === 'recommended'}
          >
            Recommended
          </Link>
          <Link
            to="/library/$libraryId"
            params={{ libraryId }}
            search={{ view: 'all', sort, unwatched }}
            className={tabCls(view === 'all')}
            role="tab"
            aria-selected={view === 'all'}
          >
            All{total !== undefined && view === 'all' ? ` · ${total}` : ''}
          </Link>
        </div>
        {view === 'all' ? (
          <>
            <select
              aria-label="Sort"
              value={sort}
              onChange={(e) => void navigate({ libraryId, sort: e.target.value, unwatched })}
              className="h-9 rounded-lg border border-line bg-bg-2 px-3 text-sm"
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-bg-2 px-3 text-sm">
              <input
                type="checkbox"
                checked={unwatched}
                onChange={(e) => void navigate({ libraryId, sort, unwatched: e.target.checked })}
                className="accent-accent"
              />
              Unwatched
            </label>
          </>
        ) : null}
      </header>

      {view === 'recommended' ? (
        hubs.isPending ? (
          <PageSpinner />
        ) : hubs.isError ? (
          <ErrorState error={hubs.error} retry={() => hubs.refetch()} />
        ) : hubs.data.length === 0 ? (
          <EmptyState title="Nothing here yet" />
        ) : (
          <div className="flex flex-col gap-8">
            {hubs.data.map((h) => (
              <Shelf
                key={h.identifier}
                title={h.title}
                items={h.items}
                shape={h.type === 'episode' ? 'landscape' : 'poster'}
              />
            ))}
          </div>
        )
      ) : all.isPending ? (
        <PageSpinner />
      ) : all.isError ? (
        <ErrorState error={all.error} retry={() => all.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No items match" />
      ) : (
        <div className="safe-px md:px-6">
          <ItemGrid items={items} />
          <div ref={sentinel} className="flex justify-center py-6">
            {all.isFetchingNextPage ? <Spinner /> : null}
          </div>
        </div>
      )}
    </div>
  )
}
