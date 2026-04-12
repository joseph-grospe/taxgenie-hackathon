import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { createUploadBatch, uploadBatchCreateSchema } from '@/lib/intake-server'
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

  const parsed = await parseJsonBodyWithDetails(request, uploadBatchCreateSchema)
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const batch = await createUploadBatch({
      userId: context.userId,
      files: parsed.data.files,
    })

    return jsonResponse(batch, { status: 201 })
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
