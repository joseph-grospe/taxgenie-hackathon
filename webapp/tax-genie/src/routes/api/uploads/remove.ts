import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { logAuditEvent } from '@/lib/audit'
import { removeUploadSchema } from '@/lib/intake-server'
import { queueUploadPurge } from '@/lib/deletion-server'
import {
  featureDisabledResponse,
  isFeatureEnabled,
} from '@/lib/feature-flags-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const handler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to remove upload files.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to remove upload files.',
    )
  }
  if (!isFeatureEnabled('purge')) return featureDisabledResponse('purge')

  const parsed = await parseJsonBodyWithDetails(request, removeUploadSchema)
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const removed = await queueUploadPurge({
      uploadId: parsed.data.uploadId,
      userId: context.userId,
    })

    if (removed.status === 'not_found') {
      return jsonResponse({ error: 'Upload not found.' }, { status: 404 })
    }

    if (removed.status === 'invalid_state') {
      return jsonResponse(
        { error: removed.eligibility.reason },
        { status: 409 },
      )
    }

    if (removed.status === 'dispatch_failed') {
      return jsonResponse(
        { error: 'Deletion was queued but the purge worker did not start.' },
        { status: 503 },
      )
    }

    if (!removed.alreadyQueued) {
      await logAuditEvent(request, {
        eventType: 'document_purge_requested',
        actorUserId: context.userId,
        targetId: removed.targetId,
        targetType: 'document',
        metadata: { requestedAt: new Date().toISOString() },
      }).catch(() => undefined)
    }

    return jsonResponse(
      {
        removedUploadId: removed.targetId,
        deletionQueued: true,
        purgeStatus: removed.purgeStatus,
      },
      { status: 202 },
    )
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/uploads/remove')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
