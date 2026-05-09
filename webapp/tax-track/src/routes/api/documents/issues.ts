import { createFileRoute } from '@tanstack/react-router'

import type { ListIssueDocumentsOptions } from '@/lib/documents-server'
import { canAccessRoute } from '@/lib/access-control'
import { listIssueDocuments } from '@/lib/documents-server'
import { parseIssueSearch } from '@/lib/issue-search-state'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const getIssueDocumentListOptions = (
  request: Request,
): ListIssueDocumentsOptions => {
  const url = new URL(request.url)
  const search = parseIssueSearch(Object.fromEntries(url.searchParams))

  return {
    status: search.status,
    q: search.q,
    severity: search.severity,
    owner: search.owner,
    entity: search.entity,
    year: search.year,
    month: search.month,
    quarter: search.quarter,
    dateFrom: search.dateFrom,
    dateTo: search.dateTo,
    page: search.page,
    pageSize: search.pageSize,
  }
}

export const issueDocumentsHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view document issues.',
    )
  }

  if (!canAccessRoute('issues', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view document issues.',
    )
  }

  return jsonResponse(
    await listIssueDocuments(getIssueDocumentListOptions(request)),
  )
}

export const Route = createFileRoute('/api/documents/issues')({
  server: {
    handlers: {
      GET: issueDocumentsHandler,
    },
  },
})
