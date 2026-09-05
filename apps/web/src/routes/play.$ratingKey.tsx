import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { PlayerCapabilities } from '@plaguex/plex-api'
import { q } from '@/plex/queries'
import { useSession } from '@/plex/session'
import { platform } from '@/platform'
import { Player, useNextEpisode } from '@/player/Player'
import { ErrorState, PageSpinner } from '@/components/ui'

export const Route = createFileRoute('/play/$ratingKey')({
  validateSearch: z.object({ restart: z.boolean().optional(), offline: z.boolean().optional() }),
  beforeLoad: () => {
    const s = useSession.getState()
    if (!s.accountToken) throw redirect({ to: '/login' })
    if (!s.activeServer) throw redirect({ to: '/servers' })
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(q.item(params.ratingKey)),
  component: PlayPage,
})

function PlayPage() {
  const { ratingKey } = Route.useParams()
  const { restart, offline } = Route.useSearch()
  const item = useQuery(q.item(ratingKey))
  const [caps, setCaps] = useState<PlayerCapabilities | null>(null)
  // undefined = still resolving the local file; null = play from the server
  const [localUrl, setLocalUrl] = useState<string | null | undefined>(offline ? undefined : null)
  useEffect(() => {
    void platform().probeCapabilities().then(setCaps)
  }, [])
  useEffect(() => {
    if (!offline) return
    const dm = platform().downloads
    if (!dm) {
      setLocalUrl(null)
      return
    }
    void dm.playbackUrl(ratingKey).then((u) => setLocalUrl(u ?? null))
  }, [offline, ratingKey])
  const next = useNextEpisode(
    item.data ?? {
      ratingKey,
      key: '',
      type: 'unknown',
      title: '',
      viewCount: 0,
      media: [],
      genres: [],
      directors: [],
      writers: [],
      roles: [],
      markers: [],
      chapters: [],
    },
  )

  if (item.isPending || !caps || localUrl === undefined)
    return (
      <div className="h-full bg-black">
        <PageSpinner />
      </div>
    )
  if (item.isError) return <ErrorState error={item.error} retry={() => item.refetch()} />
  const startMs = restart ? 0 : (item.data.viewOffsetMs ?? 0)
  return (
    <div className="h-full w-full bg-black">
      <Player
        key={`${ratingKey}-${startMs}`}
        item={item.data}
        caps={caps}
        startMs={startMs}
        next={next}
        {...(localUrl ? { localUrl } : {})}
      />
    </div>
  )
}
