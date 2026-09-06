/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLEXTV_URL?: string
  readonly VITE_PLEX_AUTH_APP_URL?: string
  readonly VITE_APP_VERSION?: string
}

/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string
