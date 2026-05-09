import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  badRequestResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const handler = async ({
  request,
}: {
  request: Request
  params: { docId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to load signing context.',
    )
  }

  if (!canAccessRoute('documents', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view document details.',
    )
  }

  return badRequestResponse(
    'Certificate signing is available from closed upload batches only.',
  )
}

export const Route = createFileRoute('/api/documents/$docId/signing-context')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
