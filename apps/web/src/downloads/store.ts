import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  downloadUrl,
  estimateDownloadBytes,
  pickDefaultMedia,
  transcodeDownloadUrl,
  type DownloadChoice,
  type Item,
} from '@plaguex/plex-api'
import type { DownloadProgress } from '@/platform'
import { getPlatform, platform } from '@/platform'
import { useSession } from '@/plex/session'
import { buildClientInfo } from '@/plex/client-info'

export interface DownloadEntry extends DownloadProgress {
  item: Item
  serverId: string
  fileName: string
  /** How it was downloaded; missing on entries from before quality selection existed. */
  choice?: DownloadChoice
}

interface DownloadsState {
  items: Record<string, DownloadEntry>
  start: (item: Item, choice?: DownloadChoice) => Promise<void>
  startMany: (items: Item[], choice?: DownloadChoice) => Promise<void>
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
      start: async (item, choice = { kind: 'original', mediaIndex: pickDefaultMedia(item) }) => {
        const { activeServer, clientIdentifier } = useSession.getState()
        const dm = platform().downloads
        if (!activeServer || !dm) return
        const client = buildClientInfo(clientIdentifier)
        const mediaIndex = choice.kind === 'original' ? choice.mediaIndex : pickDefaultMedia(item)
        const media = item.media[mediaIndex]
        const part = media?.parts[0]
        if (!part) return
        const url =
          choice.kind === 'original'
            ? downloadUrl(activeServer.baseUrl, activeServer.token, client, part)
            : transcodeDownloadUrl({
                baseUrl: activeServer.baseUrl,
                token: activeServer.token,
                client,
                item,
                mediaIndex,
                preset: choice.preset,
                sessionId: `dl-${item.ratingKey}-${Date.now()}`,
              })
        // PMS emits Matroska for progressive transcodes regardless of the requested container.
        const ext =
          choice.kind === 'original'
            ? (part.container ?? part.key.split('.').pop() ?? 'mkv')
            : 'mkv'
        const fileName = `${item.ratingKey}.${ext}`
        const size = estimateDownloadBytes(item, choice)
        set((s) => ({
          items: {
            ...s.items,
            [item.ratingKey]: {
              id: item.ratingKey,
              item,
              serverId: activeServer.clientIdentifier,
              fileName,
              choice,
              receivedBytes: 0,
              totalBytes: size,
              status: 'queued',
            },
          },
        }))
        await dm.start({
          id: item.ratingKey,
          url,
          fileName,
          // Originals report exact sizes; transcodes are chunked, so the estimate is only a hint.
          ...(choice.kind === 'original' && part.size ? { totalBytes: part.size } : {}),
        })
      },
      startMany: async (items, choice) => {
        for (const item of items) await get().start(item, choice)
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
