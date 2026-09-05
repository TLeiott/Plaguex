import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { downloadUrl, pickDefaultMedia, type Item } from '@plaguex/plex-api'
import type { DownloadProgress } from '@/platform'
import { getPlatform, platform } from '@/platform'
import { useSession } from '@/plex/session'
import { buildClientInfo } from '@/plex/client-info'

export interface DownloadEntry extends DownloadProgress {
  item: Item
  serverId: string
  fileName: string
}

interface DownloadsState {
  items: Record<string, DownloadEntry>
  start: (item: Item) => Promise<void>
  startMany: (items: Item[]) => Promise<void>
  pause: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  sync: () => Promise<void>
  applyProgress: (p: DownloadProgress) => void
}

export const useDownloads = create<DownloadsState>()(
  persist(
    (set, get) => ({
      items: {},
      start: async (item) => {
        const { activeServer, clientIdentifier } = useSession.getState()
        const dm = platform().downloads
        if (!activeServer || !dm) return
        const media = item.media[pickDefaultMedia(item)]
        const part = media?.parts[0]
        if (!part) return
        const url = downloadUrl(
          activeServer.baseUrl,
          activeServer.token,
          buildClientInfo(clientIdentifier),
          part,
        )
        const ext = part.container ?? part.key.split('.').pop() ?? 'mkv'
        const fileName = `${item.ratingKey}.${ext}`
        set((s) => ({
          items: {
            ...s.items,
            [item.ratingKey]: {
              id: item.ratingKey,
              item,
              serverId: activeServer.clientIdentifier,
              fileName,
              receivedBytes: 0,
              totalBytes: part.size ?? null,
              status: 'queued',
            },
          },
        }))
        await dm.start({
          id: item.ratingKey,
          url,
          fileName,
          ...(part.size ? { totalBytes: part.size } : {}),
        })
      },
      startMany: async (items) => {
        for (const item of items) await get().start(item)
      },
      pause: (id) => platform().downloads?.pause(id) ?? Promise.resolve(),
      resume: (id) => platform().downloads?.resume(id) ?? Promise.resolve(),
      remove: async (id) => {
        await platform().downloads?.remove(id)
        set((s) => {
          const { [id]: _gone, ...rest } = s.items
          return { items: rest }
        })
      },
      sync: async () => {
        const dm = platform().downloads
        if (!dm) return
        const list = await dm.list()
        for (const p of list) get().applyProgress(p)
      },
      applyProgress: (p) =>
        set((s) => {
          const cur = s.items[p.id]
          if (!cur) return s
          return { items: { ...s.items, [p.id]: { ...cur, ...p } } }
        }),
    }),
    {
      name: 'plaguex.downloads',
      storage: createJSONStorage(() => ({
        getItem: async (k) => (await getPlatform()).storage.get(k),
        setItem: async (k, v) => (await getPlatform()).storage.set(k, v),
        removeItem: async (k) => (await getPlatform()).storage.remove(k),
      })),
      partialize: (s) => ({ items: s.items }),
    },
  ),
)

/** Wire native progress events into the store once. */
let wired = false
export function wireDownloadEvents() {
  if (wired) return
  wired = true
  const dm = platform().downloads
  if (!dm) return
  dm.subscribe((p) => useDownloads.getState().applyProgress(p))
  void useDownloads.getState().sync()
}
