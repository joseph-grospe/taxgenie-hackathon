import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { getBatchSigningContext } from '@/lib/signing-server'
import {
  badRequestResponse,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const batchSigningContextHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to load signing context.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to sign upload batches.',
    )
  }

  try {
    const signingContext = await getBatchSigningContext(
      params.batchId,
      context.userId,
    )
    return jsonResponse({ signingContext })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to load signing context.'

    if (message === 'Upload batch not found.') {
      return jsonResponse({ error: message }, { status: 404 })
    }

    if (message === 'You do not have permission to sign this upload batch.') {
      return unauthorizedResponse(message)
    }

    return badRequestResponse(message)
  }
}

export const Route = createFileRoute(
  '/api/uploads/batches/$batchId/signing-context',
)({
  server: {
    handlers: {
      GET: batchSigningContextHandler,
    },
  },
})
