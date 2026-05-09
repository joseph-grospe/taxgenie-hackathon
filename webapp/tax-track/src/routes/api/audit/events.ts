import { createFileRoute } from '@tanstack/react-router'

import type { ListAuditEventsOptions } from '@/lib/audit'
import { canAccessRoute } from '@/lib/access-control'
import { listAuditEvents } from '@/lib/audit'
import {
  getManilaDayBoundary,
  parseAuditSearch,
} from '@/lib/audit-search-state'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const getAuditEventListOptions = (request: Request): ListAuditEventsOptions => {
  const url = new URL(request.url)
  const search = parseAuditSearch(Object.fromEntries(url.searchParams))

  return {
    q: search.q || null,
    action: search.action === 'all' ? null : search.action,
    actor: search.actor || null,
    targetType: search.targetType === 'all' ? null : search.targetType,
    dateFrom: search.dateFrom
      ? getManilaDayBoundary(search.dateFrom, 'start')
      : null,
    dateTo: search.dateTo ? getManilaDayBoundary(search.dateTo, 'end') : null,
    page: search.page,
    pageSize: search.pageSize,
  }
}

export const auditEventsHandler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required for audit logs.',
    )
  }

  if (!canAccessRoute('audit', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view audit logs.',
    )
  }

  const result = await listAuditEvents(getAuditEventListOptions(request))

  return jsonResponse({
    events: result.events,
    pagination: result.pagination,
    summary: result.summary,
    user: {
      id: context.userId,
      role: context.role,
    },
  })
}

export const Route = createFileRoute('/api/audit/events')({
  server: {
    handlers: {
      GET: auditEventsHandler,
    },
  },
})
