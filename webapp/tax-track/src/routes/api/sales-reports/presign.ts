import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  presignSalesReportUpload,
  salesReportPresignSchema,
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

export const salesReportPresignHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to upload sales reports.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to upload sales reports.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    salesReportPresignSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const result = await presignSalesReportUpload({
      userId: context.userId,
      ...parsed.data,
    })

    return jsonResponse(result, { status: 201 })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/sales-reports/presign')({
  server: {
    handlers: {
      POST: salesReportPresignHandler,
    },
  },
})
