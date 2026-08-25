import { createFileRoute } from '@tanstack/react-router'

import { getReferenceDataSummary } from '@/lib/reference-data-server'
import {
  authorizeSuperAdminRequest,
  getErrorMessage,
  jsonResponse,
} from '@/lib/user-admin-server'

export const getReferenceDataSummaryHandler = async ({
  request,
}: {
  request: Request
}) => {
  const authorization = await authorizeSuperAdminRequest(request)
  if (!authorization.ok) {
    return authorization.response
  }

  try {
    return jsonResponse({ totals: await getReferenceDataSummary() })
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, { status: 400 })
  }
}

export const Route = createFileRoute('/api/reference-data/summary' as never)({
  server: {
    handlers: {
      GET: getReferenceDataSummaryHandler,
    },
  },
})
