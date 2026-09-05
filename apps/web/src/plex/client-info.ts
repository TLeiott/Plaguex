import type { PlexClientInfo } from '@plaguex/plex-api'
import { platform } from '@/platform'

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.1.0'

export function buildClientInfo(clientIdentifier: string): PlexClientInfo {
  const p = platform()
  return {
    clientIdentifier,
    product: 'Plaguex',
    version: APP_VERSION,
    platform: p.platformName(),
    device: p.kind === 'tauri-android' ? 'Android' : 'Linux',
    deviceName: p.deviceName(),
  }
}

export function newClientIdentifier(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}
