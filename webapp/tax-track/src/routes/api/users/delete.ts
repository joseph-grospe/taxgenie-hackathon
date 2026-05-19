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
import { requireMutableManagedUser } from '@/routes/api/users/-guards'

const deletedByAdminReason = 'Deleted by admin'

export const deleteUserHandler = async ({ request }: { request: Request }) => {
  const adminContext = await requireAdminContext(request)
  if (!adminContext) {
    return notAuthenticatedResponse(
      'You must be signed in as an admin to delete users.',
    )
  }

  const body = await parseJsonBody(request, userStatusSchema)
  if (!body) {
    return badRequestResponse('Invalid delete payload.')
  }

  if (body.userId === adminContext.userId) {
    return badRequestResponse('You cannot delete your own account.')
  }

  try {
    const targetUser = await requireMutableManagedUser(request, body.userId)
    if (!targetUser.ok) {
      return targetUser.response
    }

    if (targetUser.user.role === 'super_admin') {
      return badRequestResponse('The super admin account cannot be deleted.')
    }

    const deletedAt = new Date()

    await auth.api.banUser({
      headers: request.headers,
      body: {
        userId: body.userId,
        banReason: deletedByAdminReason,
      },
    })

    await auth.api.adminUpdateUser({
      headers: request.headers,
      body: {
        userId: body.userId,
        data: {
          deletedAt,
          deletedByUserId: adminContext.userId,
          deletedReason: deletedByAdminReason,
        },
      },
    })

    await logAuditEvent(request, {
      eventType: 'user_deleted',
      actorUserId: adminContext.userId,
      targetId: body.userId,
      targetType: 'user',
      metadata: {
        email: targetUser.user.email,
        deletedAt: deletedAt.toISOString(),
      },
    }).catch(() => undefined)

    return jsonResponse({ ok: true })
  } catch (error) {
    console.error('Failed to delete user', error)
    return badRequestResponse('Unable to delete user.')
  }
}

export const Route = createFileRoute('/api/users/delete')({
  server: {
    handlers: {
      POST: deleteUserHandler,
    },
  },
})
