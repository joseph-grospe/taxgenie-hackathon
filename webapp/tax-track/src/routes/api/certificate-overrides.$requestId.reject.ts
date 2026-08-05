import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { canAccessRoute } from '@/lib/access-control'
import {
  decideCertificateOverrideRequestSchema,
  rejectCertificateOverrideRequest,
} from '@/lib/certificate-override-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const rejectCertificateOverrideRequestHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { requestId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to reject override requests.',
    )
  }

  if (!canAccessRoute('overrideRequests', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to reject override requests.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    decideCertificateOverrideRequestSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const overrideRequest = await rejectCertificateOverrideRequest({
      requestId: params.requestId,
      userId: context.userId,
      decisionNote: parsed.data.decisionNote,
    })

    await logAuditEvent(request, {
      eventType: 'certificate_override_rejected',
      actorUserId: context.userId,
      targetId: overrideRequest
        ? String(overrideRequest.certificateId)
        : params.requestId,
      targetType: overrideRequest ? 'document' : null,
      metadata: {
        requestId: params.requestId,
      },
    }).catch(() => undefined)

    return jsonResponse({ request: overrideRequest })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute(
  '/api/certificate-overrides/$requestId/reject',
)({
  server: {
    handlers: {
      POST: rejectCertificateOverrideRequestHandler,
    },
  },
})
