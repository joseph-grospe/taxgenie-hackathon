import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { logAuditEvent } from '@/lib/audit'
import {
  deleteUploadBatch,
  getUploadBatchById,
  renameUploadBatch,
  renameUploadBatchSchema,
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

export const uploadBatchDetailHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view upload batches.',
    )
  }

  if (!canAccessRoute('batches', context.role)) {
    return unauthorizedResponse('You do not have permission to view batches.')
  }

  const result = await getUploadBatchById({
    batchId: params.batchId,
  })

  if (result.status === 'not_found') {
    return jsonResponse({ error: 'Upload batch not found.' }, { status: 404 })
  }

  if (result.status === 'forbidden') {
    return unauthorizedResponse(
      'You do not have permission to view this upload batch.',
    )
  }

  return jsonResponse({ batch: result.batch })
}

export const uploadBatchRenameHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to rename upload batches.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to rename upload batches.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    renameUploadBatchSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const result = await renameUploadBatch({
      batchId: params.batchId,
      name: parsed.data.name,
    })

    if (result.status === 'not_found') {
      return jsonResponse({ error: 'Upload batch not found.' }, { status: 404 })
    }

    if (result.status === 'forbidden') {
      return unauthorizedResponse(
        'You do not have permission to rename this upload batch.',
      )
    }

    return jsonResponse({ batch: result.batch })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const uploadBatchDeleteHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to delete upload batches.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to delete upload batches.',
    )
  }

  try {
    const result = await deleteUploadBatch({
      batchId: params.batchId,
      userId: context.userId,
    })

    if (result.status === 'not_found') {
      return jsonResponse({ error: 'Upload batch not found.' }, { status: 404 })
    }

    if (result.status === 'invalid_state') {
      return badRequestResponse('Only closed upload batches can be deleted.')
    }

    await logAuditEvent(request, {
      eventType: 'batch_deleted',
      actorUserId: context.userId,
      targetId: params.batchId,
      targetType: 'batch',
      metadata: {
        deletedAt: result.batch?.deletedAt,
        purgeAfterAt: result.batch?.purgeAfterAt,
      },
    }).catch(() => undefined)

    return jsonResponse({ deleted: true, batch: result.batch })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/uploads/batches/$batchId')({
  server: {
    handlers: {
      GET: uploadBatchDetailHandler,
      PATCH: uploadBatchRenameHandler,
      DELETE: uploadBatchDeleteHandler,
    },
  },
})
