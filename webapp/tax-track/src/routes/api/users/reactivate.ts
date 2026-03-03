import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { auth } from '@/lib/auth-server'
import {
  badRequestResponse,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBody,
  requireAdminContext,
} from '@/lib/user-admin-server'
import { userStatusSchema } from '@/lib/users-module'

const handler = async ({ request }: { request: Request }) => {
  const adminContext = await requireAdminContext(request)
  if (!adminContext) {
    return notAuthenticatedResponse(
      'You must be signed in as an admin to reactivate users.',
    )
  }

  const body = await parseJsonBody(request, userStatusSchema)
  if (!body) {
    return badRequestResponse('Invalid reactivate payload.')
  }

  try {
    await auth.api.unbanUser({
      headers: request.headers,
      body: {
        userId: body.userId,
      },
    })

    await logAuditEvent(request, {
      eventType: 'user_reactivated',
      actorUserId: adminContext.userId,
      targetUserId: body.userId,
    }).catch(() => undefined)

    return jsonResponse({ ok: true })
  } catch (error) {
    console.error('Failed to reactivate user', error)
    return badRequestResponse('Unable to reactivate user.')
  }
}

export const Route = createFileRoute('/api/users/reactivate')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
