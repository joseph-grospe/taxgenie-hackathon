import {
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'

import { BatchDetailRouteContent } from '@/components/batch-detail-route-content'
import { preserveScrollDuringNavigation } from '@/hooks/use-preserved-route-search'
import { parseBatchDetailSearch } from '@/lib/batch-file-search-state'

export const Route = createFileRoute('/upload/batches/$batchId')({
  validateSearch: (search) => parseBatchDetailSearch(search),
  component: RouteComponent,
})

function RouteComponent() {
  const { batchId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
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
      backLabel="Back"
      title="Upload Batch"
      subtitle="Review all files in this batch and handle duplicate or validation issues in one place."
      search={search}
      onSearchChange={(patch, options) => {
        void preserveScrollDuringNavigation(() =>
          navigate({
            search: (previous) => {
              const nextDetailSearch = parseBatchDetailSearch({
                ...previous,
                ...patch,
                page:
                  options?.resetPage === false
                    ? (patch.page ?? previous.page)
                    : 1,
              })

              return {
                ...previous,
                ...nextDetailSearch,
              }
            },
            replace: true,
            resetScroll: false,
          }),
        )
      }}
    />
  )
}
