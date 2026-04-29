import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { createUpload, uploadCreateSchema } from '@/lib/intake-server'
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
      'Authentication is required to create upload batches.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to upload source documents.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(request, uploadCreateSchema)
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const upload = await createUpload({
      userId: context.userId,
      batchId: parsed.data.batchId,
      files: parsed.data.files,
    })

    return jsonResponse(upload, { status: 201 })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/uploads/presign')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
