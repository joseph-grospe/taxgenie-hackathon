import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { parseBatchSearch } from '@/lib/batch-search-state'
import { listUploadBatches } from '@/lib/intake-server'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const uploadBatchesListHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view batches.',
    )
  }

  if (!canAccessRoute('batches', context.role)) {
    return unauthorizedResponse('You do not have permission to view batches.')
  }

  const url = new URL(request.url)
  const search = parseBatchSearch(Object.fromEntries(url.searchParams))
  const result = await listUploadBatches(search)

  return jsonResponse(result)
}

export const Route = createFileRoute('/api/uploads/batches')({
  server: {
    handlers: {
      GET: uploadBatchesListHandler,
    },
  },
})
