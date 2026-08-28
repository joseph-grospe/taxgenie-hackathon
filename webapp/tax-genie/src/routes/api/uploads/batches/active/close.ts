import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  closeActiveUploadBatch,
  closeUploadBatch,
  closeUploadBatchSchema,
} from '@/lib/intake-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const uploadBatchActiveCloseHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to close upload batches.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to close upload batches.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(request, closeUploadBatchSchema)
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    if (parsed.data.batchId) {
      const result = await closeUploadBatch({
        batchId: parsed.data.batchId,
        userId: context.userId,
      })

      if (result.status === 'not_found') {
        return jsonResponse(
          { error: 'Upload batch not found.' },
          { status: 404 },
        )
      }

      if (result.status === 'forbidden') {
        return unauthorizedResponse(
          'You do not have permission to close this upload batch.',
        )
      }

      return jsonResponse({ batch: result.batch })
    }

    const batch = await closeActiveUploadBatch({
      userId: context.userId,
    })

    return jsonResponse({ batch })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/uploads/batches/active/close')({
  server: {
    handlers: {
      POST: uploadBatchActiveCloseHandler,
    },
  },
})
