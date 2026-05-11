import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import {
  certificateMergeAssignmentOverrideSchema,
  overrideCertificateMergeAssignment,
} from '@/lib/certificate-merge-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const mergeAssignmentOverrideHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { docId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to update merge assignments.',
    )
  }

  if (!canAccessRoute('reports', context.role)) {
    return unauthorizedResponse('You do not have permission to view reports.')
  }

  if (!canExport.pdf(context.role, context.canExportPdf)) {
    return unauthorizedResponse(
      'You do not have permission to update merge assignments.',
    )
  }

  const documentId = Number.parseInt(params.docId, 10)
  if (!Number.isInteger(documentId) || documentId <= 0) {
    return badRequestResponse('Invalid document id.')
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    certificateMergeAssignmentOverrideSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const assignment = await overrideCertificateMergeAssignment({
      documentId,
      userId: context.userId,
      request: parsed.data,
    })

    return jsonResponse({ assignment })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/documents/$docId/merge-assignment')({
  server: {
    handlers: {
      PATCH: mergeAssignmentOverrideHandler,
    },
  },
})
