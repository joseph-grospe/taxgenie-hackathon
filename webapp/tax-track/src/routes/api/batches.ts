import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { listUploadBatches } from '@/lib/intake-server'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const handler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view batch processing.',
    )
  }

  if (!canAccessRoute('batchStatus', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view batch processing.',
    )
  }

  const batches = await listUploadBatches(20)
  return jsonResponse({ batches })
}

export const Route = createFileRoute('/api/batches')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
