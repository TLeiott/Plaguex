import { Link, Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import {
  Home,
  Search,
  Download,
  Settings,
  Film,
  Tv,
  Music,
  Image as ImageIcon,
  Library as LibraryIcon,
} from 'lucide-react'
import type { LibraryType } from '@plaguex/plex-api'
import { useSession } from '@/plex/session'
import { OfflineBanner } from '@/components/OfflineBanner'
import { useLibraries } from '@/plex/queries'
import { cx } from '@/lib/format'
import { isTauri } from '@/platform'

export const Route = createFileRoute('/_app')({
  beforeLoad: () => {
    const s = useSession.getState()
    if (!s.accountToken) throw redirect({ to: '/login' })
    if (!s.activeServer) throw redirect({ to: '/servers' })
  },
  component: AppLayout,
})

const libIcon: Record<LibraryType, typeof Film> = {
  movie: Film,
  show: Tv,
  artist: Music,
  photo: ImageIcon,
  unknown: LibraryIcon,
}

function AppLayout() {
  const navigate = useNavigate()
  const server = useSession((s) => s.activeServer)
  const libraries = useLibraries()
  const showDownloads = isTauri()
  const linkCls =
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg-2 transition-colors hover:bg-bg-3 hover:text-fg [&.active]:bg-bg-3 [&.active]:text-fg'
  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Sidebar (desktop) */}
      <aside
        className="hidden w-60 shrink-0 flex-col border-r border-line bg-bg-2 p-3 md:flex"
        aria-label="Navigation"
      >
        <Link to="/" className="flex items-center gap-2 px-3 py-2">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="text-lg font-bold tracking-tight">Plaguex</span>
        </Link>
        <button
          onClick={() => navigate({ to: '/servers' })}
          className="mx-3 mb-3 truncate rounded px-1 text-left text-xs text-fg-3 hover:text-fg-2"
          title="Switch server"
          data-testid="active-server"
        >
          {server?.name}
        </button>
        <nav className="flex flex-col gap-0.5">
          <Link to="/" className={linkCls} activeOptions={{ exact: true }}>
            <Home className="size-5" /> Home
          </Link>
          <Link to="/search" className={linkCls}>
            <Search className="size-5" /> Search
          </Link>
          {showDownloads ? (
            <Link to="/downloads" className={linkCls}>
              <Download className="size-5" /> Downloads
            </Link>
          ) : null}
        </nav>
        <p className="mt-5 mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
          Libraries
        </p>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto" data-testid="library-nav">
          {libraries.data
            ?.filter((l) => l.type === 'movie' || l.type === 'show')
            .map((l) => {
              const Icon = libIcon[l.type]
              return (
                <Link
                  key={l.id}
                  to="/library/$libraryId"
                  params={{ libraryId: l.id }}
                  className={linkCls}
                >
                  <Icon className="size-5" /> <span className="truncate">{l.title}</span>
                </Link>
              )
            })}
        </nav>
        <Link to="/settings" className={cx(linkCls, 'mt-2')}>
          <Settings className="size-5" /> Settings
        </Link>
      </aside>

      {/* Content */}
      <main className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0" id="main">
        {libraries.isError ? (
          <OfflineBanner
            error={libraries.error}
            retry={() => void libraries.refetch()}
            showDownloads={showDownloads}
          />
        ) : null}
        <Outlet />
      </main>

      {/* Bottom tab bar (mobile) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line bg-bg-2/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Navigation"
      >
        {[
          { to: '/' as const, label: 'Home', Icon: Home, exact: true },
          { to: '/search' as const, label: 'Search', Icon: Search },
          ...(showDownloads
            ? [{ to: '/downloads' as const, label: 'Downloads', Icon: Download }]
            : []),
          { to: '/settings' as const, label: 'Settings', Icon: Settings },
        ].map(({ to, label, Icon, exact }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: exact ?? false }}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-fg-3 [&.active]:text-accent"
          >
            <Icon className="size-5" /> {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
