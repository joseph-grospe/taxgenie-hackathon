import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  completeUploadAndQueue,
  completeUploadSchema,
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
      'Authentication is required to queue uploaded documents.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to queue uploaded documents.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(request, completeUploadSchema)
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const upload = await completeUploadAndQueue({
      uploadId: parsed.data.uploadId,
      uploadStartedAt: parsed.data.uploadStartedAt,
      uploadFinishedAt: parsed.data.uploadFinishedAt,
    })

    if (!upload) {
      return jsonResponse({ error: 'Upload not found.' }, { status: 404 })
    }

    return jsonResponse({ upload })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/uploads/complete')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
