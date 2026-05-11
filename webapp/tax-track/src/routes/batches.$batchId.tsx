import { createFileRoute } from '@tanstack/react-router'

import { BatchDetailRouteContent } from '@/components/batch-detail-route-content'

export const Route = createFileRoute('/batches/$batchId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { batchId } = Route.useParams()

  return (
    <BatchDetailRouteContent
      batchId={batchId}
      backTo="batches"
      backLabel="Back to batches"
      title="Batch Detail"
      subtitle="Review organization batch progress, outcomes, reconciliation, and signed PDF readiness."
    />
  )
}
