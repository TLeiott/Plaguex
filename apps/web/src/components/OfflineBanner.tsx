import { Link } from '@tanstack/react-router'
import { WifiOff } from 'lucide-react'
import { useSession } from '@/plex/session'
import { Button, buttonClass } from './ui'

/** Shown when the active server cannot be reached. The rest of the app keeps working (downloads). */
export function OfflineBanner({
  error,
  retry,
  showDownloads,
}: {
  error: unknown
  retry: () => void
  showDownloads: boolean
}) {
  const name = useSession((s) => s.activeServer?.name ?? 'the server')
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div
      role="status"
      className="m-4 flex flex-wrap items-center gap-3 rounded-card border border-warn/30 bg-warn/10 p-4 text-sm safe-px"
      data-testid="offline-banner"
    >
      <WifiOff className="size-5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Can't reach {name}</p>
        <p className="truncate text-fg-2">{message}</p>
      </div>
      {showDownloads ? (
        <Link to="/downloads" className={buttonClass('primary', 'sm')}>
          Watch downloads
        </Link>
      ) : null}
      <Button size="sm" onClick={retry}>
        Retry
      </Button>
    </div>
  )
}
