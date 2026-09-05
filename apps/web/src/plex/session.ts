import { create } from 'zustand'
import { persist, type StateStorage, createJSONStorage } from 'zustand/middleware'
import type { PlexUser, ServerResource } from '@plaguex/plex-api'
import { getPlatform } from '@/platform'
import { newClientIdentifier } from './client-info'

export interface ActiveServer {
  clientIdentifier: string
  name: string
  baseUrl: string
  token: string
  owned: boolean
}

export interface Settings {
  /** undefined = original quality */
  maxBitrateKbps?: number | undefined
  /** Cap on video height (e.g. 1440 for phones that cannot show 4K). undefined = no cap. */
  maxHeight?: number | undefined
  /** 'ask' shows the chooser; 'original' downloads the source file; otherwise a preset id. */
  downloadQuality: string
  autoSkipIntro: boolean
  autoSkipCredits: boolean
  autoPlayNext: boolean
  preferredAudioLanguage?: string
  preferredSubtitleLanguage?: string
  subtitlesOnByDefault: boolean
  /** Prefer an external native player (mpv on Linux) when available. */
  externalPlayer: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  downloadQuality: 'ask',
  autoSkipIntro: false,
  autoSkipCredits: false,
  autoPlayNext: true,
  subtitlesOnByDefault: false,
  externalPlayer: false,
}

interface SessionState {
  clientIdentifier: string
  accountToken: string | null
  user: PlexUser | null
  servers: ServerResource[]
  activeServer: ActiveServer | null
  settings: Settings
  hydrated: boolean

  signIn: (token: string, user: PlexUser) => void
  signOut: () => void
  setServers: (servers: ServerResource[]) => void
  setActiveServer: (server: ActiveServer | null) => void
  updateSettings: (patch: Partial<Settings>) => void
  setHydrated: () => void
}

// Lazy: the store is created at import time, before getPlatform() has resolved.
const storage: StateStorage = {
  getItem: async (k) => (await getPlatform()).storage.get(k),
  setItem: async (k, v) => (await getPlatform()).storage.set(k, v),
  removeItem: async (k) => (await getPlatform()).storage.remove(k),
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      clientIdentifier: newClientIdentifier(),
      accountToken: null,
      user: null,
      servers: [],
      activeServer: null,
      settings: DEFAULT_SETTINGS,
      hydrated: false,

      signIn: (accountToken, user) => set({ accountToken, user }),
      signOut: () => set({ accountToken: null, user: null, servers: [], activeServer: null }),
      setServers: (servers) => set({ servers }),
      setActiveServer: (activeServer) => set({ activeServer }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'plaguex.session',
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({
        clientIdentifier: s.clientIdentifier,
        accountToken: s.accountToken,
        user: s.user,
        servers: s.servers,
        activeServer: s.activeServer,
        settings: s.settings,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.error('session hydration failed', error)
        // Mark hydrated even on error so the app boots with defaults instead of hanging.
        ;(state ?? useSession.getState()).setHydrated()
      },
    },
  ),
)
