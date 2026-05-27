import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { parseSalesReportSearch } from '@/lib/sales-report-search-state'
import { listSalesReports } from '@/lib/sales-report-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const salesReportsListHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view sales reports.',
    )
  }

  if (!canAccessRoute('reconciliation', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view sales reports.',
    )
  }

  const url = new URL(request.url)
  const search = parseSalesReportSearch(Object.fromEntries(url.searchParams))

  try {
    return jsonResponse(await listSalesReports(search))
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/sales-reports')({
  server: {
    handlers: {
      GET: salesReportsListHandler,
    },
  },
})
