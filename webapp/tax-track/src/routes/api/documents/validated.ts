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
      'Authentication is required to view validated documents.',
    )
  }

  if (!canAccessRoute('validated', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view validated documents.',
    )
  }

  const documents = await listOperationalDocuments('validated')
  return jsonResponse({ documents })
}

export const Route = createFileRoute('/api/documents/validated')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
