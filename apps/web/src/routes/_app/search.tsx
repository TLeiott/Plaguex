import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Search as SearchIcon, X } from 'lucide-react'
import { z } from 'zod'
import { q } from '@/plex/queries'
import { ItemGrid } from '@/components/ItemGrid'
import { EmptyState, Spinner } from '@/components/ui'

export const Route = createFileRoute('/_app/search')({
  validateSearch: z.object({ q: z.string().optional() }),
  component: SearchPage,
})

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function SearchPage() {
  const { q: initial = '' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [text, setText] = useState(initial)
  const debounced = useDebounced(text.trim(), 250)
  const input = useRef<HTMLInputElement>(null)
  const results = useQuery(q.search(debounced))

  useEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => {
    void navigate({ search: debounced ? { q: debounced } : {}, replace: true })
  }, [debounced, navigate])

  return (
    <div className="flex flex-col gap-6 py-6 safe-px md:px-6" data-testid="search-page">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-fg-3" />
        <input
          ref={input}
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search movies, shows, episodes…"
          aria-label="Search"
          className="h-12 w-full rounded-xl border border-line bg-bg-2 pl-12 pr-12 text-base outline-none placeholder:text-fg-3 focus:border-fg-3"
          data-testid="search-input"
        />
        {text ? (
          <button
            onClick={() => setText('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-fg-3 hover:text-fg"
            aria-label="Clear search"
          >
            <X className="size-5" />
          </button>
        ) : null}
        {results.isFetching ? (
          <Spinner className="absolute right-12 top-1/2 size-4 -translate-y-1/2" />
        ) : null}
      </div>
      {!debounced ? (
        <EmptyState title="Find something to watch">
          Type a title. Results update as you type.
        </EmptyState>
      ) : results.data && results.data.length === 0 ? (
        <EmptyState title={`No results for “${debounced}”`} />
      ) : (
        results.data?.map((hub) => (
          <section key={hub.identifier} aria-label={hub.title}>
            <h2 className="mb-3 text-lg font-semibold">{hub.title}</h2>
            <ItemGrid items={hub.items} shape={hub.type === 'episode' ? 'landscape' : 'poster'} />
          </section>
        ))
      )}
    </div>
  )
}
