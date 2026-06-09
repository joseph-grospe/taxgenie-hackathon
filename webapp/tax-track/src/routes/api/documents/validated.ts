import { createFileRoute } from '@tanstack/react-router'

import type { ListValidatedDocumentsOptions } from '@/lib/documents-server'
import { canAccessRoute } from '@/lib/access-control'
import { listValidatedDocuments } from '@/lib/documents-server'
import { parseEntityFilterIdInput } from '@/lib/entities-server'
import { parseValidatedSearch } from '@/lib/validated-search-state'
import {
  badRequestResponse,
  getErrorMessage,
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
  const entityId = url.searchParams.get('entityId') ?? search.entityId

  return {
    q: search.q,
    year: search.year,
    month: search.month,
    quarter: search.quarter,
    entity: entityId ? '' : search.entity,
    entityId,
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

  try {
    parseEntityFilterIdInput(new URL(request.url).searchParams.get('entityId'))

    return jsonResponse(
      await listValidatedDocuments({
        ...getValidatedDocumentListOptions(request),
        actor: context,
      }),
    )
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/documents/validated')({
  server: {
    handlers: {
      GET: validatedDocumentsHandler,
    },
  },
})
