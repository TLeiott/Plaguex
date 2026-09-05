import { describe, expect, it } from 'vitest'
import { plexHeaders, plexQuery, type PlexClientInfo } from '../src/headers'

const client: PlexClientInfo = {
  clientIdentifier: 'client-id',
  product: 'Plaguex',
  version: '1.2.3',
  platform: 'Linux',
  device: 'Desktop',
  deviceName: 'Living Room',
}

describe('Plex identity', () => {
  it('builds headers and includes a token only when provided', () => {
    expect(plexHeaders(client)).toEqual({
      Accept: 'application/json',
      'X-Plex-Client-Identifier': 'client-id',
      'X-Plex-Product': 'Plaguex',
      'X-Plex-Version': '1.2.3',
      'X-Plex-Platform': 'Linux',
      'X-Plex-Device': 'Desktop',
      'X-Plex-Device-Name': 'Living Room',
      'X-Plex-Provides': 'player',
    })
    expect(plexHeaders(client, 'token')['X-Plex-Token']).toBe('token')
    expect(plexHeaders(client, null)).not.toHaveProperty('X-Plex-Token')
  })

  it('adds the optional platform version to headers', () => {
    expect(plexHeaders({ ...client, platformVersion: '26' })['X-Plex-Platform-Version']).toBe('26')
  })

  it('builds query identity without header-only fields', () => {
    expect(plexQuery(client, 'token')).toEqual({
      'X-Plex-Client-Identifier': 'client-id',
      'X-Plex-Product': 'Plaguex',
      'X-Plex-Version': '1.2.3',
      'X-Plex-Platform': 'Linux',
      'X-Plex-Device': 'Desktop',
      'X-Plex-Device-Name': 'Living Room',
      'X-Plex-Token': 'token',
    })
    expect(plexQuery(client)).not.toHaveProperty('X-Plex-Token')
  })
})
