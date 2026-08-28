import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  completeSalesReportUpload,
  salesReportCompleteSchema,
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

export const salesReportCompleteHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to complete sales report uploads.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to complete sales report uploads.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    salesReportCompleteSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    return jsonResponse(await completeSalesReportUpload(parsed.data))
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/sales-reports/complete')({
  server: {
    handlers: {
      POST: salesReportCompleteHandler,
    },
  },
})
