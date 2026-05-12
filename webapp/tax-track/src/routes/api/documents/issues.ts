import { createFileRoute } from '@tanstack/react-router'

import type { ListIssueDocumentsOptions } from '@/lib/documents-server'
import { canAccessRoute } from '@/lib/access-control'
import { listIssueDocuments } from '@/lib/documents-server'
import { parseEntityFilterIdInput } from '@/lib/entities-server'
import { parseIssueSearch } from '@/lib/issue-search-state'
import {
  badRequestResponse,
  getErrorMessage,
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
  const entityId = url.searchParams.get('entityId') ?? search.entityId

  return {
    status: search.status,
    q: search.q,
    severity: search.severity,
    owner: search.owner,
    entity: entityId ? '' : search.entity,
    entityId,
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

  try {
    parseEntityFilterIdInput(new URL(request.url).searchParams.get('entityId'))

    return jsonResponse(
      await listIssueDocuments(getIssueDocumentListOptions(request)),
    )
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/documents/issues')({
  server: {
    handlers: {
      GET: issueDocumentsHandler,
    },
  },
})
