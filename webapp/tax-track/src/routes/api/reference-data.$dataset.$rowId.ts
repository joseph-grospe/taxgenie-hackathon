import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import { isReferenceDataDataset } from '@/lib/reference-data'
import {
  deleteReferenceDataRow,
  getReferenceDataErrorStatus,
  updateReferenceDataRow,
} from '@/lib/reference-data-server'
import {
  authorizeSuperAdminRequest,
  getErrorMessage,
  jsonResponse,
} from '@/lib/user-admin-server'

type RowHandlerArgs = {
  request: Request
  params: { dataset: string; rowId: string }
}

const parseRouteParams = (params: RowHandlerArgs['params']) => {
  if (!isReferenceDataDataset(params.dataset)) {
    return null
  }

  const rowId = Number.parseInt(params.rowId, 10)
  if (!Number.isSafeInteger(rowId) || rowId <= 0) {
    return null
  }

  return { dataset: params.dataset, rowId }
}

const invalidRowResponse = () =>
  jsonResponse({ error: 'Reference data row was not found.' }, { status: 404 })

export const updateReferenceDataHandler = async ({
  request,
  params,
}: RowHandlerArgs) => {
  const authorization = await authorizeSuperAdminRequest(request)
  if (!authorization.ok) {
    return authorization.response
  }

  const routeParams = parseRouteParams(params)
  if (!routeParams) {
    return invalidRowResponse()
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  try {
    const row = await updateReferenceDataRow(
      routeParams.dataset,
      routeParams.rowId,
      body,
    )
    await logAuditEvent(request, {
      eventType: 'reference_data_row_updated',
      actorUserId: authorization.context.userId,
      targetId: `${routeParams.dataset}:${routeParams.rowId}`,
      targetType: 'reference_data',
      metadata: {
        dataset: routeParams.dataset,
        rowId: routeParams.rowId,
        changedFields: Object.keys(body),
      },
    }).catch(() => undefined)

    return jsonResponse({ row })
  } catch (error) {
    return jsonResponse(
      { error: getErrorMessage(error) },
      { status: getReferenceDataErrorStatus(error) },
    )
  }
}

export const deleteReferenceDataHandler = async ({
  request,
  params,
}: RowHandlerArgs) => {
  const authorization = await authorizeSuperAdminRequest(request)
  if (!authorization.ok) {
    return authorization.response
  }

  const routeParams = parseRouteParams(params)
  if (!routeParams) {
    return invalidRowResponse()
  }

  try {
    await deleteReferenceDataRow(routeParams.dataset, routeParams.rowId)
    await logAuditEvent(request, {
      eventType: 'reference_data_row_deleted',
      actorUserId: authorization.context.userId,
      targetId: `${routeParams.dataset}:${routeParams.rowId}`,
      targetType: 'reference_data',
      metadata: {
        dataset: routeParams.dataset,
        rowId: routeParams.rowId,
      },
    }).catch(() => undefined)

    return jsonResponse({ ok: true, id: routeParams.rowId })
  } catch (error) {
    return jsonResponse(
      { error: getErrorMessage(error) },
      { status: getReferenceDataErrorStatus(error) },
    )
  }
}

export const Route = createFileRoute(
  '/api/reference-data/$dataset/$rowId' as never,
)({
  server: {
    handlers: {
      PATCH: updateReferenceDataHandler,
      DELETE: deleteReferenceDataHandler,
    },
  },
})
