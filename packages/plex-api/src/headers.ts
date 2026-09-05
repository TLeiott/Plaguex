/** Identity every Plex request carries. Plex uses these to register the device and pick a client profile. */
export interface PlexClientInfo {
  /** Stable UUID per installation. Plex ties sessions, PINs, and the device list to this. */
  clientIdentifier: string
  product: string
  version: string
  /** e.g. "Linux", "Android", "Web" */
  platform: string
  platformVersion?: string
  device: string
  deviceName: string
}

export function plexHeaders(info: PlexClientInfo, token?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'X-Plex-Client-Identifier': info.clientIdentifier,
    'X-Plex-Product': info.product,
    'X-Plex-Version': info.version,
    'X-Plex-Platform': info.platform,
    'X-Plex-Device': info.device,
    'X-Plex-Device-Name': info.deviceName,
    'X-Plex-Provides': 'player',
  }
  if (info.platformVersion) h['X-Plex-Platform-Version'] = info.platformVersion
  if (token) h['X-Plex-Token'] = token
  return h
}

/** Same identity as query params, for URLs consumed by <video>/<img> where headers cannot be set. */
export function plexQuery(info: PlexClientInfo, token?: string | null): Record<string, string> {
  const q: Record<string, string> = {
    'X-Plex-Client-Identifier': info.clientIdentifier,
    'X-Plex-Product': info.product,
    'X-Plex-Version': info.version,
    'X-Plex-Platform': info.platform,
    'X-Plex-Device': info.device,
    'X-Plex-Device-Name': info.deviceName,
  }
  if (token) q['X-Plex-Token'] = token
  return q
}
