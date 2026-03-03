import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { auth } from '@/lib/auth-server'
import { normalizeManagedUser, passwordPolicy, userCreateSchema } from '@/lib/users-module'
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

const handler = async ({ request }: { request: Request }) => {
  const adminContext = await requireAdminContext(request)
  if (!adminContext) {
    return notAuthenticatedResponse(
      'You must be signed in as an admin to create users.',
    )
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
          mustChangePassword: true,
          canExportPdf,
          canExportExcel,
        },
      },
    })

    await logAuditEvent(request, {
      eventType: 'user_created',
      actorUserId: adminContext.userId,
      targetUserId: created.user?.id,
      metadata: {
        email: body.email,
        name: body.name,
        role: body.role,
        team: body.team,
      },
    }).catch(() => undefined)

    return jsonResponse({ user: normalizeManagedUser(created.user) })
  } catch (error: unknown) {
    console.error('Failed to create user', error)
    return badRequestResponse(mapCreateUserError(error))
  }
}

export const Route = createFileRoute('/api/users/create')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
