import { plexHeaders, type PlexClientInfo } from './headers'
import { buildUrl, requestJson, type HttpOptions } from './http'
import { normalizeResource, normalizeUser } from './normalize'
import type { RawPin, RawPlexUser, RawResource } from './raw'
import type { PlexUser, ServerResource } from './types'

export const PLEX_TV = 'https://plex.tv'

export interface Pin {
  id: number
  code: string
  expiresAt: Date
  /** URL to open in a browser so the user can approve this device. */
  authUrl: string
}

export interface PlexTvOptions extends HttpOptions {
  /** Override for tests / mock server. */
  baseUrl?: string
  authAppUrl?: string
}

/** Client for plex.tv account APIs: PIN login, user info, server discovery. */
export class PlexTv {
  private readonly base: string
  private readonly authApp: string

  constructor(
    private readonly client: PlexClientInfo,
    private readonly opts: PlexTvOptions = {},
  ) {
    this.base = opts.baseUrl ?? PLEX_TV
    this.authApp = opts.authAppUrl ?? 'https://app.plex.tv/auth'
  }

  private http() {
    const h: HttpOptions = {}
    if (this.opts.fetch) h.fetch = this.opts.fetch
    if (this.opts.timeoutMs) h.timeoutMs = this.opts.timeoutMs
    return h
  }

  /**
   * Create a login PIN. Plain (4-character) PINs work with both the forwarding URL and the manual
   * plex.tv/link flow; "strong" PINs only work with the URL, leaving no fallback when the browser
   * cannot be opened.
   */
  async createPin(strong = false): Promise<Pin> {
    const raw = await requestJson<RawPin>(
      buildUrl(this.base, 'api/v2/pins', { strong: String(strong) }),
      {
        method: 'POST',
        headers: plexHeaders(this.client),
        ...this.http(),
      },
    )
    const params = new URLSearchParams({
      clientID: this.client.clientIdentifier,
      code: raw.code,
      'context[device][product]': this.client.product,
      'context[device][platform]': this.client.platform,
      'context[device][device]': this.client.device,
      'context[device][deviceName]': this.client.deviceName,
    })
    const parsed = new Date(raw.expiresAt)
    return {
      id: raw.id,
      code: raw.code,
      // Prefer the server's absolute time, fall back to the relative TTL if it is unparsable.
      expiresAt: Number.isNaN(parsed.getTime())
        ? new Date(Date.now() + raw.expiresIn * 1000)
        : parsed,
      authUrl: `${this.authApp}#?${params.toString()}`,
    }
  }

  /** Returns the auth token once the user approved the PIN, otherwise null. */
  async checkPin(id: number): Promise<string | null> {
    const raw = await requestJson<RawPin>(buildUrl(this.base, `api/v2/pins/${id}`), {
      headers: plexHeaders(this.client),
      ...this.http(),
    })
    return raw.authToken ?? null
  }

  /** Polls until the PIN is claimed, expires, or the signal aborts. */
  async waitForPin(
    pin: Pin,
    { intervalMs = 2000, signal }: { intervalMs?: number; signal?: AbortSignal } = {},
  ): Promise<string> {
    while (!signal?.aborted) {
      if (Date.now() > pin.expiresAt.getTime())
        throw new Error('Plex PIN expired before it was claimed')
      const token = await this.checkPin(pin.id)
      if (token) return token
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    throw new Error('PIN polling aborted')
  }

  async user(token: string): Promise<PlexUser> {
    const raw = await requestJson<RawPlexUser>(buildUrl(this.base, 'api/v2/user'), {
      headers: plexHeaders(this.client, token),
      ...this.http(),
    })
    return normalizeUser(raw)
  }

  /** Servers the account can access (owned + shared), with every known connection. */
  async servers(token: string): Promise<ServerResource[]> {
    const raw = await requestJson<RawResource[]>(
      buildUrl(this.base, 'api/v2/resources', { includeHttps: 1, includeRelay: 1, includeIPv6: 1 }),
      { headers: plexHeaders(this.client, token), ...this.http() },
    )
    return raw.filter((r) => r.provides.split(',').includes('server')).map(normalizeResource)
  }

  async signOut(token: string): Promise<void> {
    await requestJson(buildUrl(this.base, 'api/v2/users/signout'), {
      method: 'DELETE',
      headers: plexHeaders(this.client, token),
      ...this.http(),
    }).catch(() => undefined)
  }
}
