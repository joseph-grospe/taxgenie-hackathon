import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import { getCertificateMergeJobView } from '@/lib/certificate-merge-server'
import {
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const mergeJobDetailHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { jobId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view merge jobs.',
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

  try {
    const job = await getCertificateMergeJobView({
      mergeJobId: params.jobId,
      userId: context.userId,
      allowAdmin: context.role === 'admin',
    })

    if (!job) {
      return jsonResponse({ error: 'Merge job not found.' }, { status: 404 })
    }

    return jsonResponse({ job })
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, { status: 403 })
  }
}

export const Route = createFileRoute('/api/merge-jobs/$jobId')({
  server: {
    handlers: {
      GET: mergeJobDetailHandler,
    },
  },
})
