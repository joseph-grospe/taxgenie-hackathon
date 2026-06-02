import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { canAccessRoute } from '@/lib/access-control'
import {
  approveCertificateOverrideRequest,
  decideCertificateOverrideRequestSchema,
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

export const approveCertificateOverrideRequestHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { requestId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to approve override requests.',
    )
  }

  if (!canAccessRoute('overrideRequests', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to approve override requests.',
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
    const result = await approveCertificateOverrideRequest({
      requestId: params.requestId,
      userId: context.userId,
      decisionNote: parsed.data.decisionNote,
    })

    await logAuditEvent(request, {
      eventType: 'certificate_override_approved',
      actorUserId: context.userId,
      targetId: String(result.documentResultId),
      targetType: 'document',
      metadata: {
        requestId: result.requestId,
        matchedCount: result.matchedCount,
      },
    }).catch(() => undefined)

    return jsonResponse({ result })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute(
  '/api/certificate-overrides/$requestId/approve',
)({
  server: {
    handlers: {
      POST: approveCertificateOverrideRequestHandler,
    },
  },
})
