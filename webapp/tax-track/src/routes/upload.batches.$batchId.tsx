import {
  Outlet,
  createFileRoute,
  useRouterState,
} from '@tanstack/react-router'

import { BatchDetailRouteContent } from '@/components/batch-detail-route-content'

export const Route = createFileRoute('/upload/batches/$batchId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { batchId } = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isChildRoute = pathname.endsWith('/sign')

  if (isChildRoute) {
    return <Outlet />
  }

  return (
    <BatchDetailRouteContent
      batchId={batchId}
      backTo="upload"
      backLabel="Back to upload"
      title="Upload Batch"
      subtitle="Review all files in this batch and handle duplicate or validation issues in one place."
    />
  )
}
