import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { listDashboardEntities } from '@/lib/dashboard-server'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const dashboardEntitiesHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view dashboard entities.',
    )
  }

  if (!canAccessRoute('dashboard', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view dashboard entities.',
    )
  }

  return jsonResponse({ entities: await listDashboardEntities() })
}

export const Route = createFileRoute('/api/dashboard/entities')({
  server: {
    handlers: {
      GET: dashboardEntitiesHandler,
    },
  },
})
