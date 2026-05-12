import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { getUploadBatchById } from '@/lib/intake-server'
import { getLatestReconciliationBatch } from '@/lib/reconciliation-server'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const batchReconciliationHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view batch reconciliation results.',
    )
  }

  if (!canAccessRoute('batches', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view batch reconciliation results.',
    )
  }

  const batch = await getUploadBatchById({
    batchId: params.batchId,
  })

  if (batch.status === 'not_found') {
    return jsonResponse({ error: 'Upload batch not found.' }, { status: 404 })
  }

  if (batch.status === 'forbidden') {
    return unauthorizedResponse(
      'You do not have permission to view this upload batch.',
    )
  }

  const result = await getLatestReconciliationBatch(params.batchId)
  return jsonResponse(result)
}

export const Route = createFileRoute(
  '/api/uploads/batches/$batchId/reconciliation',
)({
  server: {
    handlers: {
      GET: batchReconciliationHandler,
    },
  },
})
