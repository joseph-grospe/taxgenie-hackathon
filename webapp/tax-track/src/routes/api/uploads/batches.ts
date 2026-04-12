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
      'Authentication is required to view upload intake.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view upload intake.',
    )
  }

  const batches = await listUploadBatches()
  return jsonResponse({ batches })
}

export const Route = createFileRoute('/api/uploads/batches')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
