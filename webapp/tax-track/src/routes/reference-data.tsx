import { createFileRoute } from '@tanstack/react-router'

import { ReferenceDataPage } from '@/components/reference-data-page'

export const Route = createFileRoute('/reference-data' as never)({
  component: ReferenceDataPage,
})
