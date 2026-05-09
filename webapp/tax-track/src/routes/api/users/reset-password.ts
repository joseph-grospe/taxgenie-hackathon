import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { auth } from '@/lib/auth-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  requireAdminContext,
} from '@/lib/user-admin-server'
import { passwordPolicy, userResetPasswordSchema } from '@/lib/users-module'

const mapResetPasswordError = (error: unknown) => {
  const message = getErrorMessage(error).toLowerCase()

  if (message.includes('not found') || message.includes('invalid user')) {
    return 'Target user was not found.'
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

  return 'Unable to reset password. Check the user and password policy.'
}

const handler = async ({ request }: { request: Request }) => {
  const adminContext = await requireAdminContext(request)
  if (!adminContext) {
    return notAuthenticatedResponse(
      'You must be signed in as an admin to reset passwords.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    userResetPasswordSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }
  const body = parsed.data

  try {
    await auth.api.setUserPassword({
      headers: request.headers,
      body: {
        userId: body.userId,
        newPassword: body.newPassword,
      },
    })

    await auth.api.adminUpdateUser({
      headers: request.headers,
      body: {
        userId: body.userId,
        data: {
          mustChangePassword: true,
        },
      },
    })

    await logAuditEvent(request, {
      eventType: 'user_password_reset',
      actorUserId: adminContext.userId,
      targetId: body.userId,
      targetType: 'user',
    }).catch(() => undefined)

    return jsonResponse({ ok: true })
  } catch (error: unknown) {
    console.error('Failed to reset password', error)
    return badRequestResponse(mapResetPasswordError(error))
  }
}

export const Route = createFileRoute('/api/users/reset-password')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
