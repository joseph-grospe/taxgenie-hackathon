import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { reopenUploadBatch, reopenUploadBatchSchema } from '@/lib/intake-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const uploadBatchReopenHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to re-open upload batches.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to re-open upload batches.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    reopenUploadBatchSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const result = await reopenUploadBatch({
      batchId: params.batchId,
      userId: context.userId,
    })

    if (result.status === 'not_found') {
      return jsonResponse({ error: 'Upload batch not found.' }, { status: 404 })
    }

    if (result.status === 'forbidden') {
      return unauthorizedResponse(
        'You do not have permission to re-open this upload batch.',
      )
    }

    return jsonResponse({ batch: result.batch })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/uploads/batches/$batchId/reopen')({
  server: {
    handlers: {
      POST: uploadBatchReopenHandler,
    },
  },
})
