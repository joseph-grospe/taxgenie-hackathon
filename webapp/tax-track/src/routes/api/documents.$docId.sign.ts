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
      'Authentication is required to sign certificates.',
    )
  }

  if (!canAccessRoute('documents', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to sign certificates.',
    )
  }

  return badRequestResponse(
    'Certificate signing is available from closed upload batches only.',
  )
}

export const Route = createFileRoute('/api/documents/$docId/sign')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
