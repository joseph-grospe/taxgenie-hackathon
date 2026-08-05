import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { canAccessRoute } from '@/lib/access-control'
import { logAuditEvent } from '@/lib/audit'
import {
  ExtractionRetryError,
  retryDocumentExtraction,
} from '@/lib/extraction-retry-server'
import {
  badRequestResponse,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const retryExtractionSchema = z.object({
  sourceDocumentResultId: z.number().int().positive(),
  sourceExtractionAttemptId: z.number().int().positive(),
})

export const handler = async ({
  request,
  params,
}: {
  request: Request
  params: { docId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to retry document extraction.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to retry document extraction.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(request, retryExtractionSchema)
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const retry = await retryDocumentExtraction({
      uploadId: params.docId,
      sourceDocumentResultId: parsed.data.sourceDocumentResultId,
      sourceExtractionAttemptId: parsed.data.sourceExtractionAttemptId,
    })

    await logAuditEvent(request, {
      eventType: 'document_extraction_retried',
      actorUserId: context.userId,
      targetId: retry.uploadId,
      targetType: 'document',
      metadata: {
        provider: 'gemini',
        failedDocumentResultId: retry.sourceDocumentResultId,
        failedExtractionAttemptId: retry.sourceExtractionAttemptId,
        retryNumber: retry.retryNumber,
        reasonCodes: retry.reasonCodes,
        revision: retry.revision,
        eventId: retry.eventId,
      },
    })

    return jsonResponse({ retry }, { status: 202 })
  } catch (error) {
    if (error instanceof ExtractionRetryError) {
      return jsonResponse({ error: error.message }, { status: error.status })
    }

    return jsonResponse(
      { error: 'Unable to retry extraction.' },
      { status: 500 },
    )
  }
}

export const Route = createFileRoute('/api/documents/$docId/retry-extraction')({
  server: {
    handlers: {
      POST: handler,
    },
  },
})
