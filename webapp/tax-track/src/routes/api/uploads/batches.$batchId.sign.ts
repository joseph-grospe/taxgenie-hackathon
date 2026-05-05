import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { canAccessRoute } from '@/lib/access-control'
import { signBatchCertificates } from '@/lib/signing-server'
import { signCertificateRequestSchema } from '@/lib/signing-module'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const batchSignHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to sign certificates.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to sign upload batches.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    signCertificateRequestSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const signedArtifacts = await signBatchCertificates(
      params.batchId,
      context.userId,
      parsed.data,
    )
    const isResignRequest = parsed.data.resign === true

    await logAuditEvent(request, {
      eventType: isResignRequest
        ? 'certificate_resigned'
        : 'certificate_signed',
      actorUserId: context.userId,
      targetId: params.batchId,
      targetType: 'batch',
      metadata: {
        batchId: params.batchId,
        resigned: isResignRequest,
        signedCount: signedArtifacts.length,
        signedAt: signedArtifacts[0]?.signedAt,
      },
    }).catch(() => undefined)

    return jsonResponse({ signedArtifacts })
  } catch (error) {
    const message = getErrorMessage(error)

    await logAuditEvent(request, {
      eventType: 'certificate_sign_failed',
      actorUserId: context.userId,
      targetId: params.batchId,
      targetType: 'batch',
      metadata: {
        batchId: params.batchId,
        error: message,
      },
    }).catch(() => undefined)

    if (message === 'Upload batch not found.') {
      return jsonResponse({ error: message }, { status: 404 })
    }

    if (message === 'You do not have permission to sign this upload batch.') {
      return unauthorizedResponse(message)
    }

    return badRequestResponse(message)
  }
}

export const Route = createFileRoute('/api/uploads/batches/$batchId/sign')({
  server: {
    handlers: {
      POST: batchSignHandler,
    },
  },
})
