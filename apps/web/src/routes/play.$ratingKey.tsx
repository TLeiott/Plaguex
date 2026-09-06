import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { Item, PlayerCapabilities } from '@plaguex/plex-api'
import { q } from '@/plex/queries'
import { useSession } from '@/plex/session'
import { platform } from '@/platform'
import { Player, useNextEpisode } from '@/player/Player'
import { ExternalSession } from '@/player/ExternalSession'
import { ErrorState, PageSpinner } from '@/components/ui'
import { useDownloads } from '@/downloads/store'

export const Route = createFileRoute('/play/$ratingKey')({
  validateSearch: z.object({
    restart: z.boolean().optional(),
    offline: z.boolean().optional(),
    /** One-off: hand this title to the external player regardless of the setting. */
    external: z.boolean().optional(),
  }),
  beforeLoad: () => {
    const s = useSession.getState()
    if (!s.accountToken) throw redirect({ to: '/login' })
    if (!s.activeServer) throw redirect({ to: '/servers' })
  },
  loader: ({ context, params }) => context.queryClient.prefetchQuery(q.item(params.ratingKey)),
  component: PlayPage,
})

function PlayPage() {
  const { ratingKey } = Route.useParams()
  const { restart, offline, external } = Route.useSearch()
  // Offline: the downloaded entry carries the full item, so no request to the server is needed.
  const downloaded = useDownloads((s) => s.items[ratingKey])
  const itemQuery = useQuery({ ...q.item(ratingKey), enabled: !(offline && downloaded) })
  const item =
    offline && downloaded
      ? {
          data: downloaded.item,
          isPending: false,
          isError: false as const,
          error: null,
          refetch: itemQuery.refetch,
        }
      : itemQuery
  const [caps, setCaps] = useState<PlayerCapabilities | null>(null)
  const externalPref = useSession((s) => s.settings.externalPlayer)
  const [useExternal, setUseExternal] = useState<boolean | null>(null)
  useEffect(() => {
    const ext = platform().externalPlayer
    if (!(externalPref || external) || !ext) {
      setUseExternal(false)
      return
    }
    void ext.available().then(setUseExternal, () => setUseExternal(false))
  }, [externalPref, external])
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
  const downloadedAll = useDownloads((s) => s.items)
  const onlineNext = useNextEpisode(
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
  const next =
    offline && downloaded ? nextDownloadedEpisode(downloaded.item, downloadedAll) : onlineNext

  if (item.isPending || !caps || localUrl === undefined || useExternal === null)
    return (
      <div className="h-full bg-black">
        <PageSpinner />
      </div>
    )
  if (item.isError || !item.data)
    return (
      <ErrorState
        error={item.error ?? new Error('Item not found')}
        retry={() => void item.refetch()}
      />
    )
  const startMs = restart ? 0 : (item.data.viewOffsetMs ?? 0)
  if (useExternal) {
    return (
      <div className="h-full w-full bg-black">
        <ExternalSession
          key={ratingKey}
          item={item.data}
          startMs={startMs}
          next={next}
          localUrl={localUrl ?? undefined}
        />
      </div>
    )
  }
  return (
    <div className="h-full w-full bg-black" data-play-root>
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

/** Next downloaded episode of the same show, in season/episode order. */
function nextDownloadedEpisode(
  current: Item,
  entries: Record<string, { item: Item; status: string }>,
): Item | null {
  if (current.type !== 'episode' || !current.grandparentRatingKey) return null
  const eps = Object.values(entries)
    .filter(
      (e) =>
        e.status === 'done' &&
        e.item.type === 'episode' &&
        e.item.grandparentRatingKey === current.grandparentRatingKey,
    )
    .map((e) => e.item)
    .sort((a, b) => (a.parentIndex ?? 0) - (b.parentIndex ?? 0) || (a.index ?? 0) - (b.index ?? 0))
  const idx = eps.findIndex((e) => e.ratingKey === current.ratingKey)
  return idx >= 0 ? (eps[idx + 1] ?? null) : null
}
