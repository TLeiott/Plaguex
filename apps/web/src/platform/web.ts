import type { Platform } from './types'
import { probeHtml5Capabilities } from './capabilities'

export function createWebPlatform(): Platform {
  return {
    kind: 'web',
    storage: {
      get: (k) => Promise.resolve(localStorage.getItem(k)),
      set: (k, v) => {
        localStorage.setItem(k, v)
        return Promise.resolve()
      },
      remove: (k) => {
        localStorage.removeItem(k)
        return Promise.resolve()
      },
    },
    openExternal: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer')
      return Promise.resolve()
    },
    probeCapabilities: () => Promise.resolve(probeHtml5Capabilities()),
    downloads: null,
    externalPlayer: null,
    nativeVideo: null,
    deviceInfo: null,
    openVideo: null,
    shareFile: null,
    screen: null,
    deviceName: () => {
      const ua = navigator.userAgent
      const browser = /Firefox/.test(ua)
        ? 'Firefox'
        : /Edg/.test(ua)
          ? 'Edge'
          : /Chrome/.test(ua)
            ? 'Chrome'
            : /Safari/.test(ua)
              ? 'Safari'
              : 'Browser'
      return `Plaguex ${browser}`
    },
    platformName: () => 'Chrome',
  }
}
