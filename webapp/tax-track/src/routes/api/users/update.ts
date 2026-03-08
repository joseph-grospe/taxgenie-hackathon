import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { auth } from '@/lib/auth-server'
import {
  badRequestResponse,
  jsonResponse,
  notAuthenticatedResponse,
  requireAdminContext,
} from '@/lib/user-admin-server'
import { userUpdateSchema } from '@/lib/users-module'

const handler = async ({ request }: { request: Request }) => {
  const adminContext = await requireAdminContext(request)
  if (!adminContext) {
    return notAuthenticatedResponse(
      'You must be signed in as an admin to update users.',
    )
  }

  const body = await request.json().catch(() => null)
  const parsed = userUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return badRequestResponse('Invalid user update payload.')
  }

  const { userId, role, team, canExportPdf, canExportExcel } = parsed.data
  if (
    role === undefined &&
    team === undefined &&
    canExportPdf === undefined &&
    canExportExcel === undefined
  ) {
    return badRequestResponse('No user fields supplied.')
  }

  const isAdminRole = role === 'admin'
  const updatePayload: Record<string, unknown> = {}
  if (team !== undefined) {
    updatePayload.team = team
  }

  if (canExportPdf !== undefined) {
    updatePayload.canExportPdf = isAdminRole ? true : canExportPdf
  }

  if (canExportExcel !== undefined) {
    updatePayload.canExportExcel = isAdminRole ? true : canExportExcel
  }

  if (isAdminRole) {
    updatePayload.canExportPdf = true
    updatePayload.canExportExcel = true
  }

  try {
    if (role !== undefined && role !== adminContext.role) {
      await auth.api.setRole({
        headers: request.headers,
        body: {
          userId,
          role,
        },
      })

      await logAuditEvent(request, {
        eventType: 'user_role_changed',
        actorUserId: adminContext.userId,
        targetUserId: userId,
        metadata: {
          role,
        },
      }).catch(() => undefined)
    }

    const hasDataUpdate = Object.keys(updatePayload).length > 0
    if (hasDataUpdate) {
      await auth.api.adminUpdateUser({
        headers: request.headers,
        body: {
          userId,
          data: updatePayload,
        },
      })

      await logAuditEvent(request, {
        eventType: updatePayload.canExportPdf !== undefined ||
          updatePayload.canExportExcel !== undefined
          ? 'user_export_override_changed'
          : 'user_updated',
        actorUserId: adminContext.userId,
        targetUserId: userId,
        metadata: updatePayload,
      }).catch(() => undefined)
    }

    return jsonResponse({ ok: true })
  } catch (error) {
    console.error('Failed to update user', error)
    return badRequestResponse('Unable to update user.')
  }
}

export const Route = createFileRoute('/api/users/update')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
