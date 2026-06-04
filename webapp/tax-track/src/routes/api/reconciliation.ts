import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { parseReconciliationSearch } from '@/lib/reconciliation-search-state'
import { listReconciliationResults } from '@/lib/reconciliation-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const reconciliationListHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view reconciliation results.',
    )
  }

  if (!canAccessRoute('reconciliation', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view reconciliation results.',
    )
  }

  const url = new URL(request.url)
  const search = parseReconciliationSearch(Object.fromEntries(url.searchParams))

  try {
    const result = await listReconciliationResults({
      q: search.q,
      filter: search.filter,
      entityId: search.entityId,
      page: search.page,
      pageSize: search.pageSize,
    })
    return jsonResponse(result)
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute('/api/reconciliation')({
  server: {
    handlers: {
      GET: reconciliationListHandler,
    },
  },
})
