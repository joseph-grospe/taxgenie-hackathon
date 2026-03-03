import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { auth } from '@/lib/auth-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
} from '@/lib/user-admin-server'
import { passwordPolicy, userChangePasswordSchema } from '@/lib/users-module'

const mapChangePasswordError = (error: unknown) => {
  const message = getErrorMessage(error).toLowerCase()

  if (
    message.includes('invalid password') ||
    message.includes('incorrect password') ||
    message.includes('credential')
  ) {
    return 'Current password is incorrect.'
  }

  if (
    message.includes('uppercase') ||
    message.includes('lowercase') ||
    message.includes('number') ||
    message.includes('symbol') ||
    message.includes('12')
  ) {
    return passwordPolicy.message
  }

  if (message.includes('same') && message.includes('password')) {
    return 'New password must be different from your current password.'
  }

  return 'Unable to change password. Verify your current password and try again.'
}

const handler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse('You must be signed in to change your password.')
  }

  const parsed = await parseJsonBodyWithDetails(request, userChangePasswordSchema)
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }
  const body = parsed.data

  try {
    await auth.api.changePassword({
      headers: request.headers,
      body: {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      },
    })

    await auth.api.adminUpdateUser({
      headers: request.headers,
      body: {
        userId: context.userId,
        data: {
          mustChangePassword: false,
        },
      },
    })

    await logAuditEvent(request, {
      eventType: context.mustChangePassword
        ? 'password_changed_first_login'
        : 'password_changed_self',
      actorUserId: context.userId,
      targetUserId: context.userId,
    }).catch(() => undefined)

    return jsonResponse({ ok: true, mustChangePassword: false })
  } catch (error: unknown) {
    console.error('Failed to change password', error)
    return badRequestResponse(mapChangePasswordError(error))
  }
}

export const Route = createFileRoute('/api/users/change-password')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
