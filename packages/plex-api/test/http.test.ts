import { describe, expect, it, vi } from 'vitest'
import { buildUrl, PlexHttpError, request } from '../src/http'

describe('buildUrl', () => {
  it.each(['http://plex.test', 'http://plex.test/'])('joins paths against %s', (base) => {
    expect(buildUrl(base, 'photo/:/transcode')).toBe('http://plex.test/photo/:/transcode')
  })

  it('serializes numbers and drops undefined query values', () => {
    const url = new URL(
      buildUrl('http://plex.test', '/library', { offset: 12, missing: undefined }),
    )
    expect(url.searchParams.get('offset')).toBe('12')
    expect(url.searchParams.has('missing')).toBe(false)
  })
})

describe('request', () => {
  it('throws a status-bearing PlexHttpError', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 401 })))
    const promise = request('http://plex.test/private', { fetch })
    await expect(promise).rejects.toMatchObject({
      status: 401,
      unauthorized: true,
      url: 'http://plex.test/private',
    })
    await expect(promise).rejects.toBeInstanceOf(PlexHttpError)
  })

  it('aborts at the configured timeout', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('timeout')), {
            once: true,
          })
        }),
    )
    const pending = request('http://plex.test/slow', { fetch, timeoutMs: 25 })
    const rejection = expect(pending).rejects.toBeDefined()
    await vi.advanceTimersByTimeAsync(25)
    await rejection
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    vi.useRealTimers()
  })

  it('propagates an outer abort signal', async () => {
    const outer = new AbortController()
    let received: AbortSignal | undefined
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          received = init?.signal ?? undefined
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        }),
    )
    const pending = request('http://plex.test/slow', { fetch, signal: outer.signal })
    outer.abort()
    await expect(pending).rejects.toThrow('aborted')
    expect(received?.aborted).toBe(true)
  })
})
