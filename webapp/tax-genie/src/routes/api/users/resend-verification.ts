import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { auth } from '@/lib/auth-server'
import {
  featureDisabledResponse,
  isFeatureEnabled,
} from '@/lib/feature-flags-server'
import {
  normalizeManagedUser,
  userVerificationEmailSchema,
} from '@/lib/users-module'
import { deletedUserMessage } from '@/routes/api/users/-guards'
import {
  badRequestResponse,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  requireAdminContext,
} from '@/lib/user-admin-server'

const sendVerificationEmailForUser = async (email: string) => {
  await auth.api.sendVerificationEmail({
    body: {
      email,
      callbackURL: '/login',
    },
  })
}

export const resendVerificationHandler = async ({
  request,
}: {
  request: Request
}) => {
  const adminContext = await requireAdminContext(request)
  if (!adminContext) {
    return notAuthenticatedResponse(
      'You must be signed in as an admin to resend verification emails.',
    )
  }
  if (!isFeatureEnabled('outbound_email')) {
    return featureDisabledResponse('outbound_email')
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    userVerificationEmailSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const user = normalizeManagedUser(
      await auth.api.getUser({
        headers: request.headers,
        query: {
          id: parsed.data.userId,
        },
      }),
    )

    if (!user.id) {
      return badRequestResponse('Target user was not found.')
    }

    if (user.isDeleted) {
      return badRequestResponse(deletedUserMessage)
    }

    if (user.isBanned) {
      return badRequestResponse(
        'Reactivate this user before resending verification email.',
      )
    }

    if (user.emailVerified) {
      return badRequestResponse('This user is already verified.')
    }

    await sendVerificationEmailForUser(user.email)

    await logAuditEvent(request, {
      eventType: 'user_verification_email_resent',
      actorUserId: adminContext.userId,
      targetId: user.id,
      targetType: 'user',
      metadata: {
        email: user.email,
      },
    }).catch(() => undefined)

    return jsonResponse({ ok: true, verificationEmailSent: true })
  } catch (error) {
    console.error('Failed to resend verification email', error)
    return badRequestResponse('Unable to resend verification email.')
  }
}

export const Route = createFileRoute('/api/users/resend-verification')({
  server: {
    handlers: {
      POST: resendVerificationHandler,
    },
  },
})
