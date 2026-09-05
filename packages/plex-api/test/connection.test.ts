import { describe, expect, it, vi } from 'vitest'
import { pickConnection, probeConnections } from '../src/connection'
import type { PlexClientInfo } from '../src/headers'
import type { ServerConnection, ServerResource } from '../src/types'

const client: PlexClientInfo = {
  clientIdentifier: 'c',
  product: 'p',
  version: '1',
  platform: 'Web',
  device: 'Browser',
  deviceName: 'Test',
}
const connection = (uri: string, local: boolean, relay: boolean): ServerConnection => ({
  uri,
  local,
  relay,
  protocol: 'http',
  address: uri,
  port: 32400,
})
const resource = (connections: ServerConnection[]): ServerResource => ({
  name: 'Plex',
  clientIdentifier: 'm',
  product: 'PMS',
  productVersion: '1',
  owned: true,
  accessToken: 'token',
  presence: true,
  httpsRequired: false,
  connections,
})

describe('connection probing', () => {
  it('drops failures and ranks local before remote before relay, then latency', async () => {
    vi.useFakeTimers()
    const connections = [
      connection('http://remote-slow', false, false),
      connection('http://relay', false, true),
      connection('http://local', true, false),
      connection('http://dead', true, false),
      connection('http://remote-fast', false, false),
    ]
    const delays: Record<string, number> = {
      'http://remote-slow': 30,
      'http://relay': 1,
      'http://local': 20,
      'http://dead': 2,
      'http://remote-fast': 5,
    }
    const fetch = vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => {
          const base = url.replace('/identity', '')
          setTimeout(
            () => resolve(new Response('', { status: base === 'http://dead' ? 503 : 200 })),
            delays[base],
          )
        }),
    )
    const pending = probeConnections(resource(connections), client, { fetch })
    await vi.runAllTimersAsync()
    const result = await pending
    expect(result.map((entry) => entry.connection.uri)).toEqual([
      'http://local',
      'http://remote-fast',
      'http://remote-slow',
      'http://relay',
    ])
    vi.useRealTimers()
  })

  it('returns null when no connection responds successfully', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 500 })))
    await expect(
      pickConnection(resource([connection('http://dead', true, false)]), client, { fetch }),
    ).resolves.toBeNull()
  })
})
