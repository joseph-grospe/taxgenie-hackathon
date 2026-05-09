import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import { listCertificateMergeEntities } from '@/lib/certificate-merge-server'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const mergeJobOptionsHandler = async ({
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

  return jsonResponse({ entities: await listCertificateMergeEntities() })
}

export const Route = createFileRoute('/api/merge-jobs/options')({
  server: {
    handlers: {
      GET: mergeJobOptionsHandler,
    },
  },
})
