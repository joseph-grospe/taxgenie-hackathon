import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  closeActiveUploadBatch,
  closeUploadBatchSchema,
} from '@/lib/intake-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const handler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to close upload batches.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to close upload batches.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(request, closeUploadBatchSchema)
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const batch = await closeActiveUploadBatch({
      userId: context.userId,
    })

    return jsonResponse({ batch })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/uploads/batches/active/close')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
