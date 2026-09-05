export class PlexHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message?: string,
  ) {
    super(message ?? `Plex request failed with ${status}: ${url}`)
    this.name = 'PlexHttpError'
  }
  get unauthorized() {
    return this.status === 401
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface HttpOptions {
  fetch?: FetchLike
  timeoutMs?: number
}

export function buildUrl(
  base: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(path, base.endsWith('/') ? base : base + '/')
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

export async function request(
  url: string,
  init: RequestInit & { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<Response> {
  const { fetch: f = globalThis.fetch, timeoutMs = 15_000, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const outer = rest.signal
  outer?.addEventListener('abort', () => controller.abort(), { once: true })
  try {
    const res = await f(url, { ...rest, signal: controller.signal })
    if (!res.ok) throw new PlexHttpError(res.status, url)
    return res
  } finally {
    clearTimeout(timer)
  }
}

export async function requestJson<T>(
  url: string,
  init: RequestInit & { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<T> {
  const res = await request(url, init)
  return (await res.json()) as T
}
