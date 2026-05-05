import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { getDashboardSummary } from '@/lib/dashboard-server'
import {
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const dashboardSummaryHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view dashboard analytics.',
    )
  }

  if (!canAccessRoute('dashboard', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view dashboard analytics.',
    )
  }

  const url = new URL(request.url)

  try {
    const summary = await getDashboardSummary({
      periodType: url.searchParams.get('periodType'),
      period: url.searchParams.get('period'),
      trendGroup: url.searchParams.get('trendGroup'),
    })

    return jsonResponse(summary)
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, { status: 400 })
  }
}

export const Route = createFileRoute('/api/dashboard/summary')({
  server: {
    handlers: {
      GET: dashboardSummaryHandler,
    },
  },
})
