import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { sendReconciliationEmail } from '@/lib/reconciliation-email-server'
import { getReconciliationRow } from '@/lib/reconciliation-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const reconciliationDetailHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { rowId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view reconciliation details.',
    )
  }

  if (!canAccessRoute('reconciliation', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view reconciliation details.',
    )
  }

  const rowId = Number.parseInt(params.rowId, 10)
  if (!Number.isFinite(rowId)) {
    return jsonResponse({ error: 'Reconciliation row not found.' }, { status: 404 })
  }

  const row = await getReconciliationRow(rowId)
  if (!row) {
    return jsonResponse({ error: 'Reconciliation row not found.' }, { status: 404 })
  }

  return jsonResponse({ row })
}

const reconciliationSendEmailHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { rowId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to send reconciliation emails.',
    )
  }

  if (!canAccessRoute('reconciliation', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to send reconciliation emails.',
    )
  }

  const rowId = Number.parseInt(params.rowId, 10)
  if (!Number.isFinite(rowId)) {
    return badRequestResponse('Reconciliation row not found.')
  }

  try {
    const result = await sendReconciliationEmail(rowId)
    return jsonResponse(result)
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/reconciliation/$rowId')({
  server: {
    handlers: {
      GET: reconciliationDetailHandler,
      POST: reconciliationSendEmailHandler,
    },
  },
})
