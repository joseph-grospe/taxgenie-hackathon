import { createFileRoute } from '@tanstack/react-router'

import { normalizeManagedUser, usersListQuerySchema } from '@/lib/users-module'
import {
  badRequestResponse,
  jsonResponse,
  notAuthenticatedResponse,
  requireAdminContext,
} from '@/lib/user-admin-server'
import { auth } from '@/lib/auth-server'

export const listUsersHandler = async ({ request }: { request: Request }) => {
  const adminContext = await requireAdminContext(request)
  if (!adminContext) {
    return notAuthenticatedResponse(
      'You must be signed in as an admin to manage users.',
    )
  }

  const parsed = usersListQuerySchema.safeParse({
    limit: new URL(request.url).searchParams.get('limit') ?? undefined,
  })

  if (!parsed.success) {
    return badRequestResponse('Invalid list request.')
  }

  try {
    const result = await auth.api.listUsers({
      headers: request.headers,
      query: {
        limit: parsed.data.limit,
      },
    })

    const rows = Array.isArray((result as { users?: Array<unknown> }).users)
      ? (result as { users: Array<unknown> }).users
      : []

    const users = rows
      .map((row) => normalizeManagedUser(row))
      .filter((user) => !user.isDeleted)

    return jsonResponse({
      users,
      total: users.length,
    })
  } catch (error) {
    console.error('Failed to list users', error)
    return badRequestResponse('Unable to load users.')
  }
}

export const Route = createFileRoute('/api/users/list')({
  server: {
    handlers: {
      GET: listUsersHandler,
    },
  },
})
