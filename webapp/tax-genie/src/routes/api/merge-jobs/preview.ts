import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import {
  certificateMergeRequestSchema,
  previewCertificateMergeJob,
} from '@/lib/certificate-merge-server'
import {
  featureDisabledResponse,
  isFeatureEnabled,
} from '@/lib/feature-flags-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const previewMergeJobHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to merge signed PDFs.',
    )
  }

  if (!canAccessRoute('reports', context.role)) {
    return unauthorizedResponse('You do not have permission to view reports.')
  }

  if (!canExport.pdf(context.role, context.canExportPdf)) {
    return unauthorizedResponse(
      'You do not have permission to export signed PDF merges.',
    )
  }
  if (!isFeatureEnabled('merge')) return featureDisabledResponse('merge')

  const parsed = await parseJsonBodyWithDetails(
    request,
    certificateMergeRequestSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    return jsonResponse({
      preview: await previewCertificateMergeJob(parsed.data),
    })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/merge-jobs/preview')({
  server: {
    handlers: {
      POST: previewMergeJobHandler,
    },
  },
})
