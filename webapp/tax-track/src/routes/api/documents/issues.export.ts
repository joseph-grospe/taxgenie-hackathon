import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import { logAuditEvent } from '@/lib/audit'
import { exportIssueDocuments } from '@/lib/documents-server'
import { parseEntityFilterIdInput } from '@/lib/entities-server'
import {
  badRequestResponse,
  getErrorMessage,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'
import { getIssueDocumentListOptions } from '@/routes/api/documents/issues'

const getIssueExportFilters = (request: Request) => {
  const options = getIssueDocumentListOptions(request, {
    includePagination: false,
  })

  return {
    status: options.status === 'all' ? null : options.status,
    q: options.q || null,
    severity: options.severity || null,
    owner: options.owner || null,
    entity: options.entity || null,
    entityId: options.entityId || null,
    year: options.year || null,
    month: options.month || null,
    quarter: options.quarter || null,
    dateFrom: options.dateFrom || null,
    dateTo: options.dateTo || null,
  }
}

export const issueDocumentsExportHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to export document issues.',
    )
  }

  if (!canAccessRoute('issues', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to export document issues.',
    )
  }

  if (!canExport.excel(context.role, context.canExportExcel)) {
    return unauthorizedResponse(
      'You do not have permission to export document issue data.',
    )
  }

  try {
    parseEntityFilterIdInput(new URL(request.url).searchParams.get('entityId'))

    const options = getIssueDocumentListOptions(request, {
      includePagination: false,
    })
    const report = await exportIssueDocuments(options)

    await logAuditEvent(request, {
      actorUserId: context.userId,
      eventType: 'issues_exported',
      metadata: {
        format: 'csv',
        filters: getIssueExportFilters(request),
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

export const Route = createFileRoute('/api/documents/issues/export')({
  server: {
    handlers: {
      GET: issueDocumentsExportHandler,
    },
  },
})
