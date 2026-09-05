import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PlexHttpError } from '@plaguex/plex-api'
import { routeTree } from './routeTree.gen'
import { getPlatform } from './platform'
import { useSession } from './plex/session'
import { installLogCapture } from './diagnostics/log'
import './styles.css'

installLogCapture()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof PlexHttpError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
})

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

async function boot() {
  await getPlatform()
  // Wait for the persisted session to load before routing decides where to send the user.
  if (!useSession.getState().hydrated) {
    await new Promise<void>((resolve) => {
      const unsub = useSession.subscribe((s) => {
        if (s.hydrated) {
          unsub()
          resolve()
        }
      })
      if (useSession.getState().hydrated) {
        unsub()
        resolve()
      }
    })
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void boot()
