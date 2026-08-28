import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { auth } from '@/lib/auth-server'
import {
  badRequestResponse,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBody,
  requireSuperAdminContext,
} from '@/lib/user-admin-server'
import { sendUserStatusNotificationEmail } from '@/lib/user-status-email-server'
import { userStatusSchema } from '@/lib/users-module'
import { requireMutableManagedUser } from '@/routes/api/users/-guards'

const userStatusNotificationWarning =
  'User status changed, but notification email could not be sent.'

export const deactivateUserHandler = async ({
  request,
}: {
  request: Request
}) => {
  const superAdminContext = await requireSuperAdminContext(request)
  if (!superAdminContext) {
    return notAuthenticatedResponse(
      'You must be signed in as a super admin to deactivate users.',
    )
  }

  const body = await parseJsonBody(request, userStatusSchema)
  if (!body) {
    return badRequestResponse('Invalid deactivate payload.')
  }

  if (body.userId === superAdminContext.userId) {
    return badRequestResponse('You cannot deactivate your own account.')
  }

  try {
    const targetUser = await requireMutableManagedUser(request, body.userId)
    if (!targetUser.ok) {
      return targetUser.response
    }

    if (targetUser.user.role === 'super_admin') {
      return badRequestResponse(
        'The super admin account cannot be deactivated.',
      )
    }

    await auth.api.banUser({
      headers: request.headers,
      body: {
        userId: body.userId,
        banReason: 'Deactivated by admin',
      },
    })

    let notificationEmailSent = true
    let warning: string | undefined
    try {
      await sendUserStatusNotificationEmail({
        status: 'deactivated',
        user: {
          email: targetUser.user.email,
          name: targetUser.user.name,
        },
      })
    } catch (error) {
      notificationEmailSent = false
      warning = userStatusNotificationWarning
      console.error(
        'Failed to send user deactivation notification email',
        error,
      )
    }

    await logAuditEvent(request, {
      eventType: 'user_deactivated',
      actorUserId: superAdminContext.userId,
      targetId: body.userId,
      targetType: 'user',
    }).catch(() => undefined)

    return jsonResponse({
      ok: true,
      notificationEmailSent,
      ...(warning ? { warning } : {}),
    })
  } catch (error) {
    console.error('Failed to deactivate user', error)
    return badRequestResponse('Unable to deactivate user.')
  }
}

export const Route = createFileRoute('/api/users/deactivate')({
  server: {
    handlers: {
      POST: deactivateUserHandler,
    },
  },
})
