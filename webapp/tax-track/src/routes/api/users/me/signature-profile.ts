import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import {
  getSignatureProfile,
  upsertSignatureProfile,
} from '@/lib/signing-server'
import { signatureProfileUpsertSchema } from '@/lib/signing-module'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
} from '@/lib/user-admin-server'

const getHandler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to load a signature profile.',
    )
  }

  const profile = await getSignatureProfile(context.userId)
  return jsonResponse({ profile })
}

const putHandler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to save a signature profile.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    signatureProfileUpsertSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const profile = await upsertSignatureProfile(context.userId, parsed.data)

    await logAuditEvent(request, {
      eventType: 'signature_profile_updated',
      actorUserId: context.userId,
      targetUserId: context.userId,
      metadata: {
        designation: profile.designation,
        tin: profile.tin,
      },
    }).catch(() => undefined)

    return jsonResponse({ profile })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/users/me/signature-profile')({
  server: {
    handlers: {
      GET: getHandler,
      PUT: putHandler,
    },
  },
})
