import { createFileRoute } from '@tanstack/react-router'

import type { ListValidatedDocumentsOptions } from '@/lib/documents-server'
import { canAccessRoute } from '@/lib/access-control'
import { listValidatedDocuments } from '@/lib/documents-server'
import { parseValidatedSearch } from '@/lib/validated-search-state'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const getValidatedDocumentListOptions = (
  request: Request,
): ListValidatedDocumentsOptions => {
  const url = new URL(request.url)
  const search = parseValidatedSearch(Object.fromEntries(url.searchParams))

  return {
    q: search.q,
    year: search.year,
    month: search.month,
    quarter: search.quarter,
    entity: search.entity,
    customerType: search.customerType,
    customerName: search.customerName,
    errorType: search.errorType,
    atc: search.atc,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
    page: search.page,
    pageSize: search.pageSize,
  }
}

export const validatedDocumentsHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view validated documents.',
    )
  }

  if (!canAccessRoute('validated', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view validated documents.',
    )
  }

  return jsonResponse(
    await listValidatedDocuments(getValidatedDocumentListOptions(request)),
  )
}

export const Route = createFileRoute('/api/documents/validated')({
  server: {
    handlers: {
      GET: validatedDocumentsHandler,
    },
  },
})
