import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { BatchDetailRouteContent } from '@/components/batch-detail-route-content'
import { parseBatchDetailSearch } from '@/lib/batch-file-search-state'

export const Route = createFileRoute('/batches/$batchId')({
  validateSearch: (search) => parseBatchDetailSearch(search),
  component: RouteComponent,
})

function RouteComponent() {
  const { batchId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  return (
    <BatchDetailRouteContent
      batchId={batchId}
      backTo="batches"
      backLabel="Back"
      title="Batch Detail"
      subtitle="Review organization batch progress, outcomes, reconciliation, and signed PDF readiness."
      search={search}
      onSearchChange={(patch, options) => {
        void navigate({
          search: (previous) =>
            parseBatchDetailSearch({
              ...previous,
              ...patch,
              page:
                options?.resetPage === false
                  ? (patch.page ?? previous.page)
                  : 1,
            }),
          replace: true,
        })
      }}
    />
  )
}
