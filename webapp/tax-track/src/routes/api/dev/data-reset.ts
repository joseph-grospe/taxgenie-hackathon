import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { logAuditEvent } from '@/lib/audit'
import { isAdmin } from '@/lib/access-control'
import {
  DEV_DATA_RESET_CONFIRMATION,
  getDevDataResetStatus,
  isDevDataResetAvailable,
  resetDevData,
} from '@/lib/dev-data-reset-server'
import {
  badRequestResponse,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const notFoundResponse = () =>
  jsonResponse({ error: 'Not found.' }, { status: 404 })

const devDataResetRequestSchema = z
  .object({
    confirmation: z.string().trim(),
  })
  .refine((value) => value.confirmation === DEV_DATA_RESET_CONFIRMATION, {
    path: ['confirmation'],
    message: `Type ${DEV_DATA_RESET_CONFIRMATION} to confirm.`,
  })

const requireDevDataResetAdmin = async (request: Request) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return {
      ok: false as const,
      response: notAuthenticatedResponse(
        'You must be signed in as an admin to clear development data.',
      ),
    }
  }

  if (!isAdmin(context.role)) {
    return {
      ok: false as const,
      response: unauthorizedResponse(
        'You do not have permission to clear development data.',
      ),
    }
  }

  return { ok: true as const, context }
}

export const devDataResetStatusHandler = async ({
  request,
}: {
  request: Request
}) => {
  if (!isDevDataResetAvailable()) {
    return notFoundResponse()
  }

  const access = await requireDevDataResetAdmin(request)
  if (!access.ok) {
    return access.response
  }

  try {
    return jsonResponse(await getDevDataResetStatus())
  } catch (error) {
    console.error('Failed to load development data reset status', error)
    return jsonResponse(
      { error: 'Unable to load development data reset status.' },
      { status: 500 },
    )
  }
}

export const devDataResetHandler = async ({
  request,
}: {
  request: Request
}) => {
  if (!isDevDataResetAvailable()) {
    return notFoundResponse()
  }

  const access = await requireDevDataResetAdmin(request)
  if (!access.ok) {
    return access.response
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    devDataResetRequestSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const result = await resetDevData()
    await logAuditEvent(request, {
      eventType: 'dev_data_reset',
      actorUserId: access.context.userId,
      metadata: {
        stage: result.stage,
        resetAt: result.resetAt,
        deletedCounts: result.deletedCounts,
      },
    }).catch((error) => {
      console.error('Failed to audit development data reset', error)
    })

    return jsonResponse(result)
  } catch (error) {
    console.error('Failed to clear development data', error)
    return jsonResponse(
      { error: 'Unable to clear development data.' },
      { status: 500 },
    )
  }
}

export const Route = createFileRoute('/api/dev/data-reset')({
  server: {
    handlers: {
      GET: devDataResetStatusHandler,
      POST: devDataResetHandler,
    },
  },
})
