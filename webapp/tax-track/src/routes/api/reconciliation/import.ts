import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  badRequestResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const reconciliationImportHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to upload reconciliation workbooks.',
    )
  }

  if (!canAccessRoute('reconciliation', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to upload reconciliation workbooks.',
    )
  }

  return badRequestResponse(
    'Revenue data import is now handled inside a closed upload batch.',
  )
}

export const Route = createFileRoute('/api/reconciliation/import')({
  server: {
    handlers: {
      POST: reconciliationImportHandler,
    },
  },
})
