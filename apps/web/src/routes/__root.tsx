import { Outlet, createRootRouteWithContext, useRouter } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { ErrorState } from '@/components/ui'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  errorComponent: ({ error, reset }) => <RootError error={error} reset={reset} />,
  notFoundComponent: () => (
    <div className="flex h-full items-center justify-center text-fg-2">Not found</div>
  ),
})

function RootError({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter()
  return (
    <div className="p-6">
      <ErrorState
        error={error}
        retry={() => {
          reset()
          void router.invalidate()
        }}
      />
    </div>
  )
}
