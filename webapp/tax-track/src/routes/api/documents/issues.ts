import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { listOperationalDocuments } from '@/lib/documents-server'
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
      'Authentication is required to view document issues.',
    )
  }

  if (!canAccessRoute('issues', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view document issues.',
    )
  }

  const documents = await listOperationalDocuments('issues')
  return jsonResponse({ documents })
}

export const Route = createFileRoute('/api/documents/issues')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
