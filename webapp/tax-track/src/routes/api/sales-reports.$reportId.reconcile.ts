import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  runSalesReportReconciliation,
  salesReportReconcileSchema,
} from '@/lib/sales-report-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const salesReportReconcileHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { reportId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to reconcile sales reports.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to reconcile sales reports.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    salesReportReconcileSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    return jsonResponse({
      report: await runSalesReportReconciliation({
        reportId: params.reportId,
        batchIds: parsed.data.batchIds,
        userId: context.userId,
      }),
    })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/sales-reports/$reportId/reconcile')({
  server: {
    handlers: {
      POST: salesReportReconcileHandler,
    },
  },
})
