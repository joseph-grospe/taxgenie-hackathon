import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { logAuditEvent } from '@/lib/audit'
import { queueBatchPurge } from '@/lib/deletion-server'
import {
  featureDisabledResponse,
  isFeatureEnabled,
} from '@/lib/feature-flags-server'
import {
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const uploadBatchPurgeHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to permanently delete upload batches.',
    )
  }
  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to permanently delete upload batches.',
    )
  }
  if (!isFeatureEnabled('purge')) return featureDisabledResponse('purge')

  try {
    const result = await queueBatchPurge({
      batchId: params.batchId,
      userId: context.userId,
    })

    if (result.status === 'not_found') {
      return jsonResponse({ error: 'Upload batch not found.' }, { status: 404 })
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
            'The permanent deletion request was saved but the purge worker could not be started. Retry or wait for the scheduled retry.',
        },
        { status: 503 },
      )
    }

    if (!result.alreadyQueued) {
      await logAuditEvent(request, {
        eventType: 'batch_purge_requested',
        actorUserId: context.userId,
        targetId: params.batchId,
        targetType: 'batch',
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

export const Route = createFileRoute('/api/uploads/batches/$batchId/purge')({
  server: { handlers: { POST: uploadBatchPurgeHandler } },
})
