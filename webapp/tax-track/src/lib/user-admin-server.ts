import type { z } from 'zod'

import type { AccessContext } from '@/lib/access-control'

import {
  isAdmin,
  isSuperAdmin,
  resolveAccessContext,
  unauthorizedMessage,
} from '@/lib/access-control'
import { auth } from '@/lib/auth-server'

type ApiResponseInit = {
  status?: number
  headers?: HeadersInit
}

export const jsonResponse = (payload: unknown, init: ApiResponseInit = {}) =>
  new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...init.headers,
    },
  })

export const unauthorizedResponse = (message = unauthorizedMessage) =>
  jsonResponse({ error: message }, { status: 403 })

export const notAuthenticatedResponse = (
  message = 'Authentication is required.',
) => jsonResponse({ error: message }, { status: 401 })

export const badRequestResponse = (message: string) =>
  jsonResponse({ error: message }, { status: 400 })

export const resolveContextFromRequest = async (
  request: Request,
): Promise<AccessContext | null> => {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session?.user) {
      return null
    }

    return resolveAccessContext(session.user)
  } catch {
    return null
  }
}

export const requireAdminContext = async (
  request: Request,
): Promise<AccessContext | null> => {
  const context = await resolveContextFromRequest(request)

  if (!context || !isAdmin(context.role)) {
    return null
  }

  return context
}

export const requireSuperAdminContext = async (
  request: Request,
): Promise<AccessContext | null> => {
  const context = await resolveContextFromRequest(request)

  if (!context || !isSuperAdmin(context.role)) {
    return null
  }

  return context
}

export const parseJsonBody = async <TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
) => {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return null
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return null
  }

  return parsed.data
}

type ParsedJsonBodyResult<TSchema extends z.ZodTypeAny> =
  | { ok: true; data: z.infer<TSchema> }
  | { ok: false; error: string }

export const parseJsonBodyWithDetails = async <TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<ParsedJsonBodyResult<TSchema>> => {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return { ok: false, error: 'Invalid JSON payload.' }
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue.message,
    }
  }

  return { ok: true, data: parsed.data }
}

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Unknown error.'
}
