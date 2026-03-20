import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { getBatchById } from '@/lib/intake-server'
import {
  badRequestResponse,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const handler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId?: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view batch processing.',
    )
  }

  if (!canAccessRoute('batchStatus', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view batch processing.',
    )
  }

  const batchId = params.batchId?.trim()
  if (!batchId) {
    return badRequestResponse('Batch id is required.')
  }

  const batch = await getBatchById(batchId)
  if (!batch) {
    return jsonResponse({ error: 'Batch not found.' }, { status: 404 })
  }

  return jsonResponse({ batch })
}

export const Route = createFileRoute('/api/batches/$batchId')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
