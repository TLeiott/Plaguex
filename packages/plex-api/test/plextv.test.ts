import { describe, expect, it, vi } from 'vitest'
import type { PlexClientInfo } from '../src/headers'
import { PlexTv, type Pin } from '../src/plextv'
import type { RawPin, RawResource } from '../src/raw'

const client: PlexClientInfo = {
  clientIdentifier: 'cid',
  product: 'Plaguex',
  version: '1',
  platform: 'Web',
  device: 'Browser',
  deviceName: 'Tim',
}
const rawPin = (authToken: string | null): RawPin => ({
  id: 12,
  code: 'ABCD',
  expiresIn: 300,
  createdAt: '2026-01-01',
  expiresAt: '2099-01-01',
  authToken,
  clientIdentifier: 'cid',
})
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const pin: Pin = { id: 12, code: 'ABCD', expiresAt: new Date('2099-01-01'), authUrl: '' }

describe('PlexTv', () => {
  it('creates a strong PIN with identity headers and an auth URL', async () => {
    const fetch = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(json(rawPin(null))))
    const result = await new PlexTv(client, {
      fetch,
      baseUrl: 'http://tv.test',
      authAppUrl: 'http://auth.test',
    }).createPin()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('http://tv.test/api/v2/pins?strong=true')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('X-Plex-Client-Identifier')).toBe('cid')
    expect(result.authUrl).toContain('clientID=cid')
    expect(result.authUrl).toContain('code=ABCD')
    expect(result.authUrl).toContain('context%5Bdevice%5D%5Bproduct%5D=Plaguex')
  })

  it.each([
    [null, null],
    ['claimed', 'claimed'],
  ] as const)('checks a PIN token %s', async (authToken, expected) => {
    const tv = new PlexTv(client, {
      baseUrl: 'http://tv.test',
      fetch: () => Promise.resolve(json(rawPin(authToken))),
    })
    await expect(tv.checkPin(12)).resolves.toBe(expected)
  })

  it('waits until a PIN is claimed', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(rawPin(null)))
      .mockResolvedValueOnce(json(rawPin('token')))
    await expect(
      new PlexTv(client, { baseUrl: 'http://tv.test', fetch }).waitForPin(pin, { intervalMs: 0 }),
    ).resolves.toBe('token')
  })

  it('rejects expired and aborted PIN polling', async () => {
    const tv = new PlexTv(client, {
      baseUrl: 'http://tv.test',
      fetch: () => Promise.resolve(json(rawPin(null))),
    })
    await expect(tv.waitForPin({ ...pin, expiresAt: new Date(Date.now() - 1) })).rejects.toThrow(
      'expired',
    )
    const controller = new AbortController()
    controller.abort()
    await expect(tv.waitForPin(pin, { signal: controller.signal })).rejects.toThrow('aborted')
  })

  it('normalizes the user and filters resources providing a server', async () => {
    const server = (name: string, provides: string): RawResource => ({
      name,
      provides,
      product: 'PMS',
      productVersion: '1',
      platform: null,
      clientIdentifier: name,
      createdAt: '',
      lastSeenAt: '',
      owned: true,
      accessToken: 'st',
      httpsRequired: false,
      presence: true,
      connections: [],
    })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json({ id: 1, uuid: 'u', username: 'tim', title: 'Tim', subscription: { active: true } }),
      )
      .mockResolvedValueOnce(json([server('mixed', 'server,client'), server('player', 'player')]))
    const tv = new PlexTv(client, { baseUrl: 'http://tv.test', fetch })
    await expect(tv.user('account-token')).resolves.toMatchObject({
      username: 'tim',
      plexPass: true,
    })
    await expect(tv.servers('account-token')).resolves.toEqual([
      expect.objectContaining({ name: 'mixed' }),
    ])
  })

  it('swallows sign-out failures', async () => {
    const tv = new PlexTv(client, {
      baseUrl: 'http://tv.test',
      fetch: () => Promise.reject(new Error('offline')),
    })
    await expect(tv.signOut('token')).resolves.toBeUndefined()
  })
})
