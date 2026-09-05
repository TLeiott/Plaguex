import { createFileRoute } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Shelf } from '@/components/Shelf'
import { Hero } from '@/components/Hero'
import { PageSpinner, ErrorState } from '@/components/ui'
import { q } from '@/plex/queries'

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(q.libraries()),
  component: HomePage,
})

function HomePage() {
  const libraries = useQuery(q.libraries())
  const cw = useQuery(q.continueWatching())
  const videoLibs = (libraries.data ?? []).filter((l) => l.type === 'movie' || l.type === 'show')
  const recent = useQueries({ queries: videoLibs.map((l) => q.recentlyAdded(l.id)) })

  if (libraries.isPending) return <PageSpinner />
  if (libraries.isError)
    return <ErrorState error={libraries.error} retry={() => libraries.refetch()} />

  const heroItem = cw.data?.[0]
  return (
    <div className="flex flex-col gap-8 pb-8" data-testid="home">
      {heroItem ? <Hero item={heroItem} /> : <div className="h-6" />}
      {cw.data && cw.data.length > 0 ? (
        <Shelf title="Continue Watching" items={cw.data} shape="landscape" />
      ) : null}
      {videoLibs.map((l, i) => {
        const r = recent[i]
        return r?.data && r.data.length > 0 ? (
          <Shelf key={l.id} title={`Recently added in ${l.title}`} items={r.data} />
        ) : null
      })}
    </div>
  )
}
