import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { listRecentUploads } from '@/lib/intake-server'
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

  const { uploads, summary } = await listRecentUploads()
  return jsonResponse({ uploads, summary })
}

export const Route = createFileRoute('/api/uploads/recent')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
