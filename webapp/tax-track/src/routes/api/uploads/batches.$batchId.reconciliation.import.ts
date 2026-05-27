import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  badRequestResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const batchReconciliationImportHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to import revenue data.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to import revenue data.',
    )
  }

  void params

  return badRequestResponse(
    'Sales report reconciliation is now handled from the Reconciliation page.',
  )
}

export const Route = createFileRoute(
  '/api/uploads/batches/$batchId/reconciliation/import',
)({
  server: {
    handlers: {
      POST: batchReconciliationImportHandler,
    },
  },
})
