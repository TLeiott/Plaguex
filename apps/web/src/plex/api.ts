import { PlexServer, PlexTv } from '@plaguex/plex-api'
import { buildClientInfo } from './client-info'
import { useSession } from './session'

const PLEXTV_URL: string | undefined = import.meta.env.VITE_PLEXTV_URL
const AUTH_APP_URL: string | undefined = import.meta.env.VITE_PLEX_AUTH_APP_URL

export function plexTv(): PlexTv {
  const { clientIdentifier } = useSession.getState()
  const opts: ConstructorParameters<typeof PlexTv>[1] = {}
  if (PLEXTV_URL) opts.baseUrl = PLEXTV_URL
  if (AUTH_APP_URL) opts.authAppUrl = AUTH_APP_URL
  return new PlexTv(buildClientInfo(clientIdentifier), opts)
}

let cached: { key: string; server: PlexServer } | null = null

/** PlexServer for the active server. Memoised per (baseUrl, token). Throws when no server is selected. */
export function activeServer(): PlexServer {
  const { activeServer: a, clientIdentifier } = useSession.getState()
  if (!a) throw new Error('No active Plex server')
  const key = `${a.baseUrl}|${a.token}|${clientIdentifier}`
  if (cached?.key !== key)
    cached = { key, server: new PlexServer(a.baseUrl, a.token, buildClientInfo(clientIdentifier)) }
  return cached.server
}

/** React hook variant that re-renders when the active server changes. */
export function useServer(): PlexServer {
  useSession((s) => s.activeServer?.baseUrl)
  useSession((s) => s.activeServer?.token)
  return activeServer()
}
