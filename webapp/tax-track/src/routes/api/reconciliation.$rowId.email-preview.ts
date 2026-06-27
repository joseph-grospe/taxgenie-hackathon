import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, isAdmin, isEditor } from '@/lib/access-control'
import { getReconciliationEmailPreview } from '@/lib/reconciliation-email-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const reconciliationEmailPreviewHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { rowId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to preview reconciliation emails.',
    )
  }

  if (!canAccessRoute('reconciliation', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to preview reconciliation emails.',
    )
  }
  if (!isAdmin(context.role) && !isEditor(context.role)) {
    return unauthorizedResponse(
      'You do not have permission to preview reconciliation emails.',
    )
  }

  const rowId = Number.parseInt(params.rowId, 10)
  if (!Number.isFinite(rowId)) {
    return badRequestResponse('Reconciliation row not found.')
  }

  try {
    const preview = await getReconciliationEmailPreview(rowId)
    return jsonResponse(preview)
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute(
  '/api/reconciliation/$rowId/email-preview',
)({
  server: {
    handlers: {
      GET: reconciliationEmailPreviewHandler,
    },
  },
})
