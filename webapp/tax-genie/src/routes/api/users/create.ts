import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { auth } from '@/lib/auth-server'
import {
  featureDisabledResponse,
  isFeatureEnabled,
} from '@/lib/feature-flags-server'
import {
  normalizeManagedUser,
  passwordPolicy,
  userCreateSchema,
} from '@/lib/users-module'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  requireAdminContext,
} from '@/lib/user-admin-server'

const mapCreateUserError = (error: unknown) => {
  const message = getErrorMessage(error).toLowerCase()

  if (message.includes('already exists') || message.includes('duplicate')) {
    return 'A user with this email already exists.'
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

  return 'Unable to create user. Check role, email, and password policy.'
}

const sendVerificationEmailForUser = async (email: string) => {
  await auth.api.sendVerificationEmail({
    body: {
      email,
      callbackURL: '/login',
    },
  })
}

export const createUserHandler = async ({ request }: { request: Request }) => {
  const adminContext = await requireAdminContext(request)
  if (!adminContext) {
    return notAuthenticatedResponse(
      'You must be signed in as an admin to create users.',
    )
  }
  if (!isFeatureEnabled('outbound_email')) {
    return featureDisabledResponse('outbound_email')
  }

  const parsed = await parseJsonBodyWithDetails(request, userCreateSchema)
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }
  const body = parsed.data

  const canExportPdf = body.role === 'admin' ? true : body.canExportPdf
  const canExportExcel = body.role === 'admin' ? true : body.canExportExcel

  try {
    const created = await auth.api.createUser({
      headers: request.headers,
      body: {
        email: body.email,
        password: body.password,
        name: body.name,
        role: body.role,
        data: {
          team: body.team,
          emailVerified: false,
          mustChangePassword: true,
          canExportPdf,
          canExportExcel,
        },
      },
    })

    let verificationEmailSent = true
    let warning: string | undefined
    try {
      await sendVerificationEmailForUser(body.email)
    } catch (error: unknown) {
      verificationEmailSent = false
      warning =
        'User was created, but the verification email could not be sent.'
      console.error('Failed to send user verification email', error)
    }

    await logAuditEvent(request, {
      eventType: 'user_created',
      actorUserId: adminContext.userId,
      targetId: created.user.id,
      targetType: 'user',
      metadata: {
        email: body.email,
        name: body.name,
        role: body.role,
        team: body.team,
        verificationEmailSent,
      },
    }).catch(() => undefined)

    return jsonResponse({
      user: normalizeManagedUser(created.user),
      verificationEmailSent,
      ...(warning ? { warning } : {}),
    })
  } catch (error: unknown) {
    console.error('Failed to create user', error)
    return badRequestResponse(mapCreateUserError(error))
  }
}

export const Route = createFileRoute('/api/users/create')({
  server: {
    handlers: {
      POST: createUserHandler,
    },
  },
})
