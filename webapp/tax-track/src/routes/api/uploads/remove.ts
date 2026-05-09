import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  removeUploadFromBatch,
  removeUploadSchema,
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
      'Authentication is required to remove upload files.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to remove upload files.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(request, removeUploadSchema)
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const removed = await removeUploadFromBatch({
      uploadId: parsed.data.uploadId,
      userId: context.userId,
    })

    if (!removed) {
      return jsonResponse({ error: 'Upload not found.' }, { status: 404 })
    }

    return jsonResponse(removed)
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/uploads/remove')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
