import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { logAuditEvent } from '@/lib/audit'
import { queueUploadPurge } from '@/lib/deletion-server'
import {
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const uploadDeleteHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { uploadId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to delete certificate files.',
    )
  }
  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to delete certificate files.',
    )
  }

  try {
    const result = await queueUploadPurge({
      uploadId: params.uploadId,
      userId: context.userId,
    })

    if (result.status === 'not_found') {
      return jsonResponse({ error: 'Upload file not found.' }, { status: 404 })
    }
    if (result.status === 'invalid_state') {
      return jsonResponse(
        { error: result.eligibility.reason, eligibility: result.eligibility },
        { status: 409 },
      )
    }
    if (result.status === 'dispatch_failed') {
      return jsonResponse(
        {
          error:
            'The deletion request was saved but the purge worker could not be started. Retry the deletion or wait for the scheduled retry.',
        },
        { status: 503 },
      )
    }

    if (!result.alreadyQueued) {
      await logAuditEvent(request, {
        eventType: 'document_purge_requested',
        actorUserId: context.userId,
        targetId: params.uploadId,
        targetType: 'document',
        metadata: { requestedAt: new Date().toISOString() },
      }).catch(() => undefined)
    }

    return jsonResponse(
      {
        deletionQueued: true,
        targetId: result.targetId,
        purgeStatus: result.purgeStatus,
      },
      { status: 202 },
    )
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, { status: 400 })
  }
}

export const Route = createFileRoute('/api/uploads/$uploadId')({
  server: { handlers: { DELETE: uploadDeleteHandler } },
})
