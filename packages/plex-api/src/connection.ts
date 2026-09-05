import { plexHeaders, type PlexClientInfo } from './headers'
import { request, type FetchLike } from './http'
import type { ServerConnection, ServerResource } from './types'

export interface ReachableConnection {
  connection: ServerConnection
  latencyMs: number
}

/**
 * Race every advertised connection and return the ones that answer, fastest first.
 * Preference order on ties: local > remote direct > relay. Relay is always last because
 * Plex caps relay bandwidth, which is the #1 cause of "why is this transcoding at 2 Mbps".
 */
export async function probeConnections(
  server: ServerResource,
  client: PlexClientInfo,
  { fetch: f, timeoutMs = 5000 }: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<ReachableConnection[]> {
  const token = server.accessToken ?? undefined
  const results = await Promise.all(
    server.connections.map(async (connection): Promise<ReachableConnection | null> => {
      const start = Date.now()
      try {
        const init: Parameters<typeof request>[1] = {
          headers: plexHeaders(client, token),
          timeoutMs,
        }
        if (f) init.fetch = f
        await request(`${connection.uri}/identity`, init)
        return { connection, latencyMs: Date.now() - start }
      } catch {
        return null
      }
    }),
  )
  const rank = (c: ServerConnection) => (c.relay ? 2 : c.local ? 0 : 1)
  return results
    .filter((r): r is ReachableConnection => r !== null)
    .sort((a, b) => rank(a.connection) - rank(b.connection) || a.latencyMs - b.latencyMs)
}

/** First reachable connection, or null if the server cannot be reached at all. */
export async function pickConnection(
  server: ServerResource,
  client: PlexClientInfo,
  opts?: { fetch?: FetchLike; timeoutMs?: number },
): Promise<ServerConnection | null> {
  const reachable = await probeConnections(server, client, opts)
  return reachable[0]?.connection ?? null
}
