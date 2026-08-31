import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport, isAdmin } from '@/lib/access-control'
import { getCertificateMergeOutputDownload } from '@/lib/certificate-merge-server'
import {
  featureDisabledResponse,
  isFeatureEnabled,
} from '@/lib/feature-flags-server'
import {
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const mergeJobOutputDownloadHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { jobId: string; partNumber: string }
}) => {
  if (!isFeatureEnabled('merge')) return featureDisabledResponse('merge')

  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to download merge outputs.',
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

  const partNumber = Number.parseInt(params.partNumber, 10)
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 3) {
    return jsonResponse(
      { error: 'Invalid output part number.' },
      { status: 400 },
    )
  }

  try {
    const download = await getCertificateMergeOutputDownload({
      mergeJobId: params.jobId,
      partNumber,
      userId: context.userId,
      allowAdmin: isAdmin(context.role),
    })

    return jsonResponse({ download })
  } catch (error) {
    const message = getErrorMessage(error)
    const status = message.includes('not ready') ? 409 : 404
    return jsonResponse({ error: message }, { status })
  }
}

export const Route = createFileRoute(
  '/api/merge-jobs/$jobId/outputs/$partNumber',
)({
  server: {
    handlers: {
      GET: mergeJobOutputDownloadHandler,
    },
  },
})
