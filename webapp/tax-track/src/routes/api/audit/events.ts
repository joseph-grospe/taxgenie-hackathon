import { createFileRoute } from '@tanstack/react-router'

import { listAuditEvents } from '@/lib/audit'
import { jsonResponse, notAuthenticatedResponse, resolveContextFromRequest } from '@/lib/user-admin-server'

const handler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse('Authentication is required for audit logs.')
  }

  const rawLimit = new URL(request.url).searchParams.get('limit')
  const limit = Number.parseInt(rawLimit ?? '100', 10)
  const safeLimit = Number.isNaN(limit) ? 100 : Math.max(1, Math.min(300, limit))

  const events = await listAuditEvents(safeLimit)

  return jsonResponse({
    events,
    user: {
      id: context.userId,
      role: context.role,
    },
  })
}

export const Route = createFileRoute('/api/audit/events')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
