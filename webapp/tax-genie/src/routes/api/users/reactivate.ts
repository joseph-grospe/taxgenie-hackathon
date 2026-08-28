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

export const reactivateUserHandler = async ({
  request,
}: {
  request: Request
}) => {
  const superAdminContext = await requireSuperAdminContext(request)
  if (!superAdminContext) {
    return notAuthenticatedResponse(
      'You must be signed in as a super admin to reactivate users.',
    )
  }

  const body = await parseJsonBody(request, userStatusSchema)
  if (!body) {
    return badRequestResponse('Invalid reactivate payload.')
  }

  try {
    const targetUser = await requireMutableManagedUser(request, body.userId)
    if (!targetUser.ok) {
      return targetUser.response
    }

    if (targetUser.user.role === 'super_admin') {
      return badRequestResponse(
        'The super admin account cannot be reactivated.',
      )
    }

    await auth.api.unbanUser({
      headers: request.headers,
      body: {
        userId: body.userId,
      },
    })

    let notificationEmailSent = true
    let warning: string | undefined
    try {
      await sendUserStatusNotificationEmail({
        status: 'reactivated',
        user: {
          email: targetUser.user.email,
          name: targetUser.user.name,
        },
      })
    } catch (error) {
      notificationEmailSent = false
      warning = userStatusNotificationWarning
      console.error(
        'Failed to send user reactivation notification email',
        error,
      )
    }

    await logAuditEvent(request, {
      eventType: 'user_reactivated',
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
    console.error('Failed to reactivate user', error)
    return badRequestResponse('Unable to reactivate user.')
  }
}

export const Route = createFileRoute('/api/users/reactivate')({
  server: {
    handlers: {
      POST: reactivateUserHandler,
    },
  },
})
