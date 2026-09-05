import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { ErrorState } from '@/components/ui'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  errorComponent: ({ error, reset }) => (
    <div className="p-6">
      <ErrorState error={error} retry={reset} />
    </div>
  ),
  notFoundComponent: () => (
    <div className="flex h-full items-center justify-center text-fg-2">Not found</div>
  ),
})
