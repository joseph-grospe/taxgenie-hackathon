import { createFileRoute } from '@tanstack/react-router'

import { ReferenceDataPage } from '@/components/reference-data-page'
import { parseReferenceDataSearch } from '@/lib/reference-data-search-state'

function ReferenceDataRoute() {
  const search = Route.useSearch()
  return <ReferenceDataPage search={search} />
}

export const Route = createFileRoute('/reference-data' as never)({
  validateSearch: (search) => parseReferenceDataSearch(search),
  component: ReferenceDataRoute,
})
