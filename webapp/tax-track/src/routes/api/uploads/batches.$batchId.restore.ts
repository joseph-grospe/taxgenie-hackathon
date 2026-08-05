import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { logAuditEvent } from '@/lib/audit'
import { restoreUploadBatch } from '@/lib/intake-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const uploadBatchRestoreHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to restore upload batches.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to restore upload batches.',
    )
  }

  try {
    const result = await restoreUploadBatch({
      batchId: params.batchId,
      userId: context.userId,
    })

    if (result.status === 'not_found') {
      return jsonResponse({ error: 'Upload batch not found.' }, { status: 404 })
    }

    if (result.status === 'expired') {
      return badRequestResponse(
        'This upload batch can no longer be restored because its Recently Deleted retention window has passed.',
      )
    }

    if (result.status === 'purge_started') {
      return jsonResponse(
        {
          error:
            'Permanent deletion has already started and this batch can no longer be restored.',
        },
        { status: 409 },
      )
    }

    await logAuditEvent(request, {
      eventType: 'batch_restored',
      actorUserId: context.userId,
      targetId: params.batchId,
      targetType: 'batch',
      metadata: {
        restoredAt: new Date().toISOString(),
      },
    }).catch(() => undefined)

    return jsonResponse({ restored: true, batch: result.batch })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/uploads/batches/$batchId/restore')({
  server: {
    handlers: {
      POST: uploadBatchRestoreHandler,
    },
  },
})
