import { createFileRoute } from '@tanstack/react-router'

import { jsonResponse, notAuthenticatedResponse } from '@/lib/user-admin-server'
import { resolveContextFromRequest } from '@/lib/user-admin-server'

const handler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)

  if (!context) {
    return notAuthenticatedResponse()
  }

  return jsonResponse(context)
}

export const Route = createFileRoute('/api/access-context')({
  server: {
    handlers: {
      GET: handler,
    },
  },
})
