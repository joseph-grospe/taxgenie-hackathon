import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  updateDocumentExtractedFields,
  updateExtractedFieldsSchema,
} from '@/lib/documents-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const updateDocumentExtractedFieldsHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { docId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to update extracted fields.',
    )
  }

  if (!canAccessRoute('validated', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view validated documents.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    updateExtractedFieldsSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const document = await updateDocumentExtractedFields({
      documentId: params.docId,
      actor: context,
      fields: parsed.data,
    })

    return jsonResponse({ document })
  } catch (error) {
    const message = getErrorMessage(error)
    return message === 'You do not have permission to update extracted fields.'
      ? unauthorizedResponse(message)
      : badRequestResponse(message)
  }
}

export const Route = createFileRoute('/api/documents/$docId/extracted-fields')({
  server: {
    handlers: {
      PATCH: updateDocumentExtractedFieldsHandler,
    },
  },
})
