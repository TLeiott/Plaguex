import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Play, Check, Eye, EyeOff, Download, Star, ChevronLeft } from 'lucide-react'
import type { Item } from '@plaguex/plex-api'
import { q, useWatchedMutation } from '@/plex/queries'
import { PlexImage } from '@/components/PlexImage'
import { ItemCard } from '@/components/ItemCard'
import { Badge, Button, buttonClass, ErrorState, PageSpinner, ProgressBar } from '@/components/ui'
import { MediaInfo } from '@/components/MediaInfo'
import { cx, episodeCode, formatDuration, progressFraction, resolutionLabel } from '@/lib/format'
import { isTauri } from '@/platform'
import { useDownloads } from '@/downloads/store'

export const Route = createFileRoute('/_app/item/$ratingKey')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(q.item(params.ratingKey)),
  component: ItemPage,
})

function ItemPage() {
  const { ratingKey } = Route.useParams()
  const item = useQuery(q.item(ratingKey))
  if (item.isPending) return <PageSpinner />
  if (item.isError) return <ErrorState error={item.error} retry={() => item.refetch()} />
  const it = item.data
  if (it.type === 'show') return <ShowPage show={it} />
  if (it.type === 'season') return <SeasonPage season={it} />
  return <VideoPage item={it} />
}

function BackLink({
  to,
  params,
  label,
}: {
  to: '/item/$ratingKey' | '/'
  params?: { ratingKey: string }
  label: string
}) {
  return (
    <Link
      to={to}
      {...(params ? { params } : {})}
      className="inline-flex items-center gap-1 text-sm text-fg-2 hover:text-fg"
    >
      <ChevronLeft className="size-4" /> {label}
    </Link>
  )
}

function Backdrop({ path }: { path: string | undefined }) {
  return (
    <div className="absolute inset-x-0 top-0 -z-10 h-[45vh] overflow-hidden md:h-[60vh]">
      <PlexImage path={path} width={1280} height={720} className="h-full w-full opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-b from-bg/20 via-bg/70 to-bg" />
    </div>
  )
}

function WatchedButton({ item }: { item: Item }) {
  const m = useWatchedMutation()
  const watched =
    item.type === 'movie' || item.type === 'episode'
      ? item.viewCount > 0
      : (item.leafCount ?? 0) > 0 && item.leafCount === item.viewedLeafCount
  return (
    <Button
      variant="ghost"
      onClick={() => m.mutate({ ratingKey: item.ratingKey, watched: !watched })}
      loading={m.isPending}
      aria-pressed={watched}
      data-testid="toggle-watched"
    >
      {watched ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      {watched ? 'Mark unwatched' : 'Mark watched'}
    </Button>
  )
}

function DownloadButton({ item }: { item: Item }) {
  const start = useDownloads((s) => s.start)
  const entry = useDownloads((s) => s.items[item.ratingKey])
  if (!isTauri()) return null
  if (entry?.status === 'done') return <Badge tone="accent">Downloaded</Badge>
  if (entry && entry.status !== 'error') return <Badge>Downloading…</Badge>
  return (
    <Button variant="ghost" onClick={() => void start(item)} data-testid="download">
      <Download className="size-5" /> Download
    </Button>
  )
}

function VideoPage({ item }: { item: Item }) {
  const progress = progressFraction(item.viewOffsetMs, item.durationMs)
  const media = item.media[0]
  const isEpisode = item.type === 'episode'
  return (
    <div className="relative" data-testid="item-page">
      <Backdrop path={item.art ?? item.grandparentArt} />
      <div className="flex flex-col gap-6 px-4 pt-6 safe-px md:flex-row md:gap-10 md:px-10 md:pt-[22vh]">
        <div className="hidden w-56 shrink-0 md:block">
          <PlexImage
            path={isEpisode ? item.grandparentThumb : item.thumb}
            width={224}
            height={336}
            className="aspect-[2/3] w-full rounded-card shadow-2xl"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {isEpisode && item.grandparentRatingKey ? (
            <BackLink
              to="/item/$ratingKey"
              params={{ ratingKey: item.parentRatingKey ?? item.grandparentRatingKey }}
              label={item.grandparentTitle ?? 'Show'}
            />
          ) : null}
          <div>
            {isEpisode ? (
              <p className="text-sm font-semibold text-accent">
                {episodeCode(item.parentIndex, item.index)}
              </p>
            ) : null}
            <h1 className="text-3xl font-bold tracking-tight md:text-5xl">{item.title}</h1>
            {item.tagline ? <p className="mt-2 text-fg-2 italic">{item.tagline}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
            {item.year ? <span>{item.year}</span> : null}
            {item.durationMs ? <span>{formatDuration(item.durationMs)}</span> : null}
            {item.contentRating ? <Badge>{item.contentRating}</Badge> : null}
            {media ? <Badge>{resolutionLabel(media.height, media.videoResolution)}</Badge> : null}
            {media?.parts[0]?.streams.some((s) => s.hdr) ? <Badge tone="warn">HDR</Badge> : null}
            {item.rating ? (
              <span className="inline-flex items-center gap-1">
                <Star className="size-4 fill-warn text-warn" /> {item.rating.toFixed(1)}
              </span>
            ) : null}
          </div>
          {progress > 0 ? (
            <div className="flex items-center gap-3 text-sm text-fg-2">
              <ProgressBar value={progress} className="max-w-xs" />
              {formatDuration((item.durationMs ?? 0) - (item.viewOffsetMs ?? 0), {
                compact: true,
              })}{' '}
              left
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/play/$ratingKey"
              params={{ ratingKey: item.ratingKey }}
              className={buttonClass('primary', 'lg')}
              data-testid="play"
            >
              <Play className="size-5 fill-current" /> {progress > 0 ? 'Resume' : 'Play'}
            </Link>
            {progress > 0 ? (
              <Link
                to="/play/$ratingKey"
                params={{ ratingKey: item.ratingKey }}
                search={{ restart: true }}
                className={buttonClass('secondary', 'lg')}
              >
                Start over
              </Link>
            ) : null}
            <WatchedButton item={item} />
            <DownloadButton item={item} />
          </div>
          {item.summary ? (
            <p className="max-w-3xl leading-relaxed text-fg">{item.summary}</p>
          ) : null}
          <dl className="grid max-w-3xl grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            {item.genres.length ? (
              <Row k="Genres" v={item.genres.map((g) => g.tag).join(', ')} />
            ) : null}
            {item.directors.length ? (
              <Row k="Director" v={item.directors.map((g) => g.tag).join(', ')} />
            ) : null}
            {item.writers.length ? (
              <Row k="Writers" v={item.writers.map((g) => g.tag).join(', ')} />
            ) : null}
            {item.studio ? <Row k="Studio" v={item.studio} /> : null}
            {item.releaseDate ? <Row k="Released" v={item.releaseDate} /> : null}
          </dl>
          {item.roles.length ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-3">
                Cast
              </h2>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {item.roles.slice(0, 12).map((r) => (
                  <li key={r.id ?? r.tag}>
                    <span className="text-fg">{r.tag}</span>
                    {r.role ? <span className="text-fg-3"> as {r.role}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <MediaInfo item={item} />
        </div>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-fg-3">{k}</dt>
      <dd className="text-fg">{v}</dd>
    </>
  )
}

function ShowPage({ show }: { show: Item }) {
  const seasons = useQuery(q.children(show.ratingKey))
  const onDeck = useQuery({
    ...q.allEpisodes(show.ratingKey),
    select: (eps) =>
      eps.find((e) => e.viewOffsetMs) ?? eps.find((e) => e.viewCount === 0) ?? eps[0],
  })
  const unwatched = (show.leafCount ?? 0) - (show.viewedLeafCount ?? 0)
  return (
    <div className="relative" data-testid="item-page">
      <Backdrop path={show.art} />
      <div className="flex flex-col gap-6 px-4 pt-6 safe-px md:flex-row md:gap-10 md:px-10 md:pt-[22vh]">
        <div className="hidden w-56 shrink-0 md:block">
          <PlexImage
            path={show.thumb}
            width={224}
            height={336}
            className="aspect-[2/3] w-full rounded-card shadow-2xl"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">{show.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
            {show.year ? <span>{show.year}</span> : null}
            {show.childCount ? <span>{show.childCount} seasons</span> : null}
            {show.leafCount ? <span>{show.leafCount} episodes</span> : null}
            {show.contentRating ? <Badge>{show.contentRating}</Badge> : null}
            {unwatched > 0 ? <Badge tone="accent">{unwatched} unwatched</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onDeck.data ? (
              <Link
                to="/play/$ratingKey"
                params={{ ratingKey: onDeck.data.ratingKey }}
                className={buttonClass('primary', 'lg')}
                data-testid="play"
              >
                <Play className="size-5 fill-current" />
                {onDeck.data.viewOffsetMs ? 'Resume' : 'Play'}{' '}
                {episodeCode(onDeck.data.parentIndex, onDeck.data.index)}
              </Link>
            ) : null}
            <WatchedButton item={show} />
          </div>
          {show.summary ? <p className="max-w-3xl leading-relaxed">{show.summary}</p> : null}
          {show.genres.length ? (
            <p className="text-sm text-fg-2">{show.genres.map((g) => g.tag).join(' · ')}</p>
          ) : null}
          <section className="mt-4">
            <h2 className="mb-3 text-lg font-semibold">Seasons</h2>
            {seasons.isPending ? <PageSpinner /> : null}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 md:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] md:gap-4">
              {seasons.data?.map((s) => (
                <ItemCard
                  key={s.ratingKey}
                  item={{ ...s, parentTitle: undefined as unknown as string }}
                  showContext={false}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function SeasonPage({ season }: { season: Item }) {
  const episodes = useQuery(q.children(season.ratingKey))
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <div className="relative" data-testid="item-page">
      <Backdrop path={season.art ?? season.grandparentArt} />
      <div className="flex flex-col gap-6 px-4 pt-6 safe-px md:px-10 md:pt-[18vh]">
        {season.parentRatingKey ? (
          <BackLink
            to="/item/$ratingKey"
            params={{ ratingKey: season.parentRatingKey }}
            label={season.parentTitle ?? 'Show'}
          />
        ) : null}
        <div className="flex items-end gap-6">
          <PlexImage
            path={season.thumb}
            width={160}
            height={240}
            className="hidden aspect-[2/3] w-32 rounded-card shadow-2xl sm:block md:w-40"
          />
          <div>
            <p className="text-sm text-fg-2">{season.parentTitle}</p>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{season.title}</h1>
            <div className="mt-2 flex items-center gap-2 text-sm text-fg-2">
              {season.leafCount ? <span>{season.leafCount} episodes</span> : null}
              <WatchedButton item={season} />
            </div>
          </div>
        </div>
        <ol className="flex flex-col divide-y divide-line" data-testid="episode-list">
          {episodes.data?.map((ep) => {
            const progress = progressFraction(ep.viewOffsetMs, ep.durationMs)
            const open = expanded === ep.ratingKey
            return (
              <li key={ep.ratingKey} className="flex gap-4 py-3">
                <Link
                  to="/play/$ratingKey"
                  params={{ ratingKey: ep.ratingKey }}
                  className="group relative w-36 shrink-0 overflow-hidden rounded-lg bg-bg-3 sm:w-48"
                  aria-label={`Play ${ep.title}`}
                >
                  <PlexImage
                    path={ep.thumb}
                    width={192}
                    height={108}
                    className="aspect-video w-full"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <Play className="size-8 fill-current text-white" />
                  </span>
                  {ep.viewCount > 0 && !ep.viewOffsetMs ? (
                    <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-accent-fg">
                      <Check className="size-3.5" />
                    </span>
                  ) : null}
                  {progress > 0 ? (
                    <ProgressBar
                      value={progress}
                      className="absolute inset-x-0 bottom-0 rounded-none"
                    />
                  ) : null}
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-fg-3">{ep.index}</span>
                    <Link
                      to="/item/$ratingKey"
                      params={{ ratingKey: ep.ratingKey }}
                      className="truncate font-medium hover:underline"
                    >
                      {ep.title}
                    </Link>
                    <span className="ml-auto shrink-0 text-xs text-fg-3">
                      {formatDuration(ep.durationMs, { compact: true })}
                    </span>
                  </div>
                  <button
                    onClick={() => setExpanded(open ? null : ep.ratingKey)}
                    className={cx('mt-1 text-left text-sm text-fg-2', !open && 'line-clamp-2')}
                    aria-expanded={open}
                  >
                    {ep.summary}
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
