import { createFileRoute } from '@tanstack/react-router'

import {
  SIGNING_TEAM_REQUIRED_MESSAGE,
  canAccessRoute,
  canSignCertificates,
} from '@/lib/access-control'
import {
  badRequestResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const documentSignHandler = async ({
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

  if (!canSignCertificates(context)) {
    return unauthorizedResponse(SIGNING_TEAM_REQUIRED_MESSAGE)
  }

  return badRequestResponse(
    'Certificate signing is available from closed upload batches only.',
  )
}

export const Route = createFileRoute('/api/documents/$docId/sign')({
  server: {
    handlers: {
      POST: documentSignHandler,
    },
  },
})
