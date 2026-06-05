import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { removeSalesReportBatch } from '@/lib/sales-report-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const salesReportBatchDeleteHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { reportId: string; batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to update sales report batches.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to update sales report batches.',
    )
  }

  try {
    const report = await removeSalesReportBatch({
      reportId: params.reportId,
      batchId: params.batchId,
      userId: context.userId,
    })

    if (!report) {
      return jsonResponse({ error: 'Sales report not found.' }, { status: 404 })
    }

    return jsonResponse({ report })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute(
  '/api/sales-reports/$reportId/batches/$batchId',
)({
  server: {
    handlers: {
      DELETE: salesReportBatchDeleteHandler,
    },
  },
})
