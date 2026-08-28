import { createFileRoute } from '@tanstack/react-router'

import type { AuditExportFormat, ExportAuditEventsOptions } from '@/lib/audit'
import { canAccessRoute } from '@/lib/access-control'
import { logAuditEvent } from '@/lib/audit'
import { exportAuditEvents } from '@/lib/audit-export-server'
import {
  getManilaDayBoundary,
  parseAuditSearch,
} from '@/lib/audit-search-state'
import {
  badRequestResponse,
  getErrorMessage,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

type AuditExportRequestOptions = {
  options: ExportAuditEventsOptions
  filters: Record<string, string | null>
}

const parseAuditExportFormat = (
  value: string | null,
): AuditExportFormat | null =>
  value === 'csv' || value === 'xlsx' ? value : null

const getAuditExportRequestOptions = (
  request: Request,
): AuditExportRequestOptions => {
  const url = new URL(request.url)
  const search = parseAuditSearch(Object.fromEntries(url.searchParams))

  return {
    options: {
      q: search.q || null,
      action: search.action === 'all' ? null : search.action,
      actor: search.actor || null,
      targetType: search.targetType === 'all' ? null : search.targetType,
      dateFrom: search.dateFrom
        ? getManilaDayBoundary(search.dateFrom, 'start')
        : null,
      dateTo: search.dateTo
        ? getManilaDayBoundary(search.dateTo, 'end')
        : null,
    },
    filters: {
      q: search.q || null,
      action: search.action === 'all' ? null : search.action,
      actor: search.actor || null,
      targetType: search.targetType === 'all' ? null : search.targetType,
      dateFrom: search.dateFrom || null,
      dateTo: search.dateTo || null,
    },
  }
}

export const auditExportHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to export audit logs.',
    )
  }

  if (!canAccessRoute('audit', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to export audit logs.',
    )
  }

  const url = new URL(request.url)
  const format = parseAuditExportFormat(url.searchParams.get('format'))
  if (!format) {
    return badRequestResponse('Export format must be either csv or xlsx.')
  }

  const { options, filters } = getAuditExportRequestOptions(request)

  try {
    const report = await exportAuditEvents(options, format)

    await logAuditEvent(request, {
      actorUserId: context.userId,
      eventType: 'audit_exported',
      metadata: {
        format,
        filters,
        rowCount: report.rowCount,
      },
    })

    return new Response(report.content as unknown as BodyInit, {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': report.contentType,
        'content-disposition': `attachment; filename="${report.fileName}"`,
      },
    })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/audit/export')({
  server: {
    handlers: {
      GET: auditExportHandler,
    },
  },
})
