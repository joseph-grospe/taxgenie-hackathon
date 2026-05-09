import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { listUploadEntities } from '@/lib/entities-server'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const uploadEntitiesHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view upload entities.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to upload source documents.',
    )
  }

  return jsonResponse({ entities: await listUploadEntities() })
}

export const Route = createFileRoute('/api/uploads/entities' as never)({
  server: {
    handlers: {
      GET: uploadEntitiesHandler,
    },
  },
})
