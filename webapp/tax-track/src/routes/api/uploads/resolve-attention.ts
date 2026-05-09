import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  resolveUploadAttention,
  resolveUploadAttentionSchema,
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
      'Authentication is required to resolve upload issues.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to resolve upload issues.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    resolveUploadAttentionSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const upload = await resolveUploadAttention({
      uploadId: parsed.data.uploadId,
      userId: context.userId,
    })

    if (!upload) {
      return jsonResponse({ error: 'Upload not found.' }, { status: 404 })
    }

    return jsonResponse({ upload })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/uploads/resolve-attention')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
