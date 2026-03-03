import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { auth } from '@/lib/auth-server'
import {
  badRequestResponse,
  jsonResponse,
  notAuthenticatedResponse,
  requireAdminContext,
  parseJsonBody,
} from '@/lib/user-admin-server'
import { userStatusSchema } from '@/lib/users-module'

const handler = async ({ request }: { request: Request }) => {
  const adminContext = await requireAdminContext(request)
  if (!adminContext) {
    return notAuthenticatedResponse(
      'You must be signed in as an admin to deactivate users.',
    )
  }

  const body = await parseJsonBody(request, userStatusSchema)
  if (!body) {
    return badRequestResponse('Invalid deactivate payload.')
  }

  if (body.userId === adminContext.userId) {
    return badRequestResponse('You cannot deactivate your own account.')
  }

  try {
    await auth.api.banUser({
      headers: request.headers,
      body: {
        userId: body.userId,
        banReason: 'Deactivated by admin',
      },
    })

    await logAuditEvent(request, {
      eventType: 'user_deactivated',
      actorUserId: adminContext.userId,
      targetUserId: body.userId,
    }).catch(() => undefined)

    return jsonResponse({ ok: true })
  } catch (error) {
    console.error('Failed to deactivate user', error)
    return badRequestResponse('Unable to deactivate user.')
  }
}

export const Route = createFileRoute('/api/users/deactivate')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
