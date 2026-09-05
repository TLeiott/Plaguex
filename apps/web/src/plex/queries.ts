import { queryOptions, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ListOptions } from '@plaguex/plex-api'
import { activeServer } from './api'
import { useSession } from './session'

const serverKey = () => useSession.getState().activeServer?.clientIdentifier ?? 'none'

export const q = {
  libraries: () =>
    queryOptions({
      queryKey: [serverKey(), 'libraries'],
      queryFn: () => activeServer().libraries(),
      staleTime: 5 * 60_000,
    }),
  continueWatching: () =>
    queryOptions({
      queryKey: [serverKey(), 'continueWatching'],
      queryFn: () => activeServer().continueWatching(30),
      staleTime: 30_000,
    }),
  recentlyAdded: (libraryId: string) =>
    queryOptions({
      queryKey: [serverKey(), 'recentlyAdded', libraryId],
      queryFn: () => activeServer().recentlyAdded(libraryId, 24),
      staleTime: 60_000,
    }),
  libraryHubs: (libraryId: string) =>
    queryOptions({
      queryKey: [serverKey(), 'hubs', libraryId],
      queryFn: () => activeServer().libraryHubs(libraryId),
      staleTime: 60_000,
    }),
  libraryItems: (libraryId: string, o: ListOptions) =>
    queryOptions({
      queryKey: [serverKey(), 'libraryItems', libraryId, o],
      queryFn: () => activeServer().libraryItems(libraryId, o),
      staleTime: 60_000,
    }),
  item: (ratingKey: string) =>
    queryOptions({
      queryKey: [serverKey(), 'item', ratingKey],
      queryFn: () => activeServer().item(ratingKey),
      staleTime: 30_000,
    }),
  children: (ratingKey: string) =>
    queryOptions({
      queryKey: [serverKey(), 'children', ratingKey],
      queryFn: () => activeServer().children(ratingKey),
      staleTime: 30_000,
    }),
  allEpisodes: (showKey: string) =>
    queryOptions({
      queryKey: [serverKey(), 'allEpisodes', showKey],
      queryFn: () => activeServer().allEpisodes(showKey),
      staleTime: 30_000,
    }),
  search: (query: string) =>
    queryOptions({
      queryKey: [serverKey(), 'search', query],
      queryFn: () => activeServer().search(query),
      enabled: query.trim().length > 0,
      staleTime: 60_000,
    }),
}

export const useLibraries = () => useQuery(q.libraries())
export const useItem = (ratingKey: string) => useQuery(q.item(ratingKey))
export const useChildren = (ratingKey: string) => useQuery(q.children(ratingKey))

export function useWatchedMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ratingKey, watched }: { ratingKey: string; watched: boolean }) => {
      const s = activeServer()
      if (watched) await s.markWatched(ratingKey)
      else await s.markUnwatched(ratingKey)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [serverKey()] }),
  })
}
