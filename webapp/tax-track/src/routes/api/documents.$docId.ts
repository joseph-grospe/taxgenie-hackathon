import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { getOperationalDocument } from '@/lib/documents-server'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const handler = async ({
  request,
  params,
}: {
  request: Request
  params: { docId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view document details.',
    )
  }

  if (!canAccessRoute('documents', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view document details.',
    )
  }

  const document = await getOperationalDocument(params.docId)
  if (!document) {
    return jsonResponse({ error: 'Document not found.' }, { status: 404 })
  }

  return jsonResponse({ document })
}

export const Route = createFileRoute('/api/documents/$docId')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
