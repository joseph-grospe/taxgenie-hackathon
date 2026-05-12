import { createFileRoute } from '@tanstack/react-router'

import { canAccessPath } from '@/lib/access-control'
import { listEntityScopeOptions } from '@/lib/entities-server'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const entitiesHandler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view entities.',
    )
  }

  if (!canAccessPath('/dashboard', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view entities.',
    )
  }

  return jsonResponse({ entities: await listEntityScopeOptions() })
}

export const Route = createFileRoute('/api/entities' as never)({
  server: {
    handlers: {
      GET: entitiesHandler,
    },
  },
})
