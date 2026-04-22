import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { listReconciliationResults } from '@/lib/reconciliation-server'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const reconciliationListHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view reconciliation results.',
    )
  }

  if (!canAccessRoute('reconciliation', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view reconciliation results.',
    )
  }

  const result = await listReconciliationResults()
  return jsonResponse(result)
}

export const Route = createFileRoute('/api/reconciliation')({
  server: {
    handlers: {
      GET: reconciliationListHandler,
    },
  },
})
