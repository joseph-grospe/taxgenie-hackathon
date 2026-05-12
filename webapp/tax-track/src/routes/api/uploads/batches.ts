import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { parseBatchSearch } from '@/lib/batch-search-state'
import { parseEntityFilterIdInput } from '@/lib/entities-server'
import { listUploadBatches } from '@/lib/intake-server'
import {
  badRequestResponse,
  getErrorMessage,
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
  try {
    parseEntityFilterIdInput(url.searchParams.get('entityId'))
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }

  const search = parseBatchSearch(Object.fromEntries(url.searchParams))
  try {
    const result = await listUploadBatches({
      ...search,
      entity: search.entityId ? '' : search.entity,
      entityId: url.searchParams.get('entityId') ?? search.entityId,
    })

    return jsonResponse(result)
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/uploads/batches')({
  server: {
    handlers: {
      GET: uploadBatchesListHandler,
    },
  },
})
