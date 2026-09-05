import { useEffect, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Server, Wifi, WifiOff, LogOut, RefreshCw } from 'lucide-react'
import { probeConnections, type ServerResource, type ServerConnection } from '@plaguex/plex-api'
import { plexTv } from '@/plex/api'
import { useSession } from '@/plex/session'
import { buildClientInfo } from '@/plex/client-info'
import { Button, Spinner, ErrorState } from '@/components/ui'
import { cx } from '@/lib/format'

export const Route = createFileRoute('/servers')({
  beforeLoad: () => {
    if (!useSession.getState().accountToken) throw redirect({ to: '/login' })
  },
  component: ServersPage,
})

type Probe =
  | { state: 'probing' }
  | { state: 'ok'; connection: ServerConnection; latencyMs: number }
  | { state: 'offline' }

function ServersPage() {
  const navigate = useNavigate()
  const { accountToken, servers, clientIdentifier, setServers, setActiveServer, signOut, user } =
    useSession()
  const [loading, setLoading] = useState(servers.length === 0)
  const [error, setError] = useState<unknown>(null)
  const [probes, setProbes] = useState<Record<string, Probe>>({})

  const refresh = async () => {
    if (!accountToken) return
    setLoading(true)
    setError(null)
    try {
      const list = await plexTv().servers(accountToken)
      setServers(list)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (servers.length === 0) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const info = buildClientInfo(clientIdentifier)
    let cancelled = false
    // Probing is async by nature; state updates only happen once results arrive.
    void Promise.resolve().then(() => {
      if (cancelled) return
      setProbes(Object.fromEntries(servers.map((s) => [s.clientIdentifier, { state: 'probing' }])))
      for (const s of servers) {
        void probeConnections(s, info).then((r) => {
          if (cancelled) return
          const best = r[0]
          setProbes((p) => ({
            ...p,
            [s.clientIdentifier]: best
              ? { state: 'ok', connection: best.connection, latencyMs: best.latencyMs }
              : { state: 'offline' },
          }))
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [servers, clientIdentifier])

  const choose = async (s: ServerResource) => {
    const p = probes[s.clientIdentifier]
    if (p?.state !== 'ok' || !s.accessToken) return
    setActiveServer({
      clientIdentifier: s.clientIdentifier,
      name: s.name,
      baseUrl: p.connection.uri,
      token: s.accessToken,
      owned: s.owned,
    })
    await navigate({ to: '/' })
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 p-6 safe-px">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Choose a server</h1>
          {user ? <p className="text-sm text-fg-2">Signed in as {user.title}</p> : null}
        </div>
        <div className="flex gap-2">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh servers"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw className={cx('size-5', loading && 'animate-spin')} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Sign out"
            onClick={() => {
              signOut()
              void navigate({ to: '/login' })
            }}
          >
            <LogOut className="size-5" />
          </Button>
        </div>
      </header>

      {error ? <ErrorState error={error} retry={refresh} /> : null}
      {loading && servers.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : null}

      <ul className="flex flex-col gap-2" data-testid="server-list">
        {servers.map((s) => {
          const p = probes[s.clientIdentifier]
          const ok = p?.state === 'ok'
          return (
            <li key={s.clientIdentifier}>
              <button
                onClick={() => choose(s)}
                disabled={!ok}
                className="flex w-full items-center gap-4 rounded-card border border-line bg-bg-2 p-4 text-left transition-colors hover:border-fg-3 disabled:cursor-default disabled:opacity-60"
                data-testid="server-item"
              >
                <Server className="size-6 shrink-0 text-fg-2" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{s.name}</p>
                  <p className="truncate text-xs text-fg-3">
                    {s.owned ? 'Owned' : 'Shared'} · {s.platform ?? 'Plex Media Server'}{' '}
                    {s.productVersion}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-fg-2">
                  {p?.state === 'probing' ? <Spinner className="size-4" /> : null}
                  {p?.state === 'ok' ? (
                    <>
                      <Wifi className="size-4 text-accent" />
                      {p.connection.local
                        ? 'Local'
                        : p.connection.relay
                          ? 'Relay'
                          : 'Remote'} · {p.latencyMs} ms
                    </>
                  ) : null}
                  {p?.state === 'offline' ? (
                    <>
                      <WifiOff className="size-4 text-danger" /> Unreachable
                    </>
                  ) : null}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
      {!loading && servers.length === 0 && !error ? (
        <p className="text-center text-sm text-fg-2">No servers are shared with this account.</p>
      ) : null}
    </main>
  )
}
