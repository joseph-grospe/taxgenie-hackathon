import { createFileRoute } from '@tanstack/react-router'

import { logAuditEvent } from '@/lib/audit'
import {
  REFERENCE_DATA_DEFAULT_PAGE_SIZE,
  REFERENCE_DATA_MAX_PAGE_SIZE,
  isReferenceDataDataset,
} from '@/lib/reference-data'
import {
  createReferenceDataRow,
  getReferenceDataErrorStatus,
  listReferenceDataRows,
} from '@/lib/reference-data-server'
import {
  authorizeSuperAdminRequest,
  getErrorMessage,
  jsonResponse,
} from '@/lib/user-admin-server'

type CollectionHandlerArgs = {
  request: Request
  params: { dataset: string }
}

const invalidDatasetResponse = () =>
  jsonResponse({ error: 'Reference data set was not found.' }, { status: 404 })

const parsePositiveInteger = (value: string | null, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const listReferenceDataHandler = async ({
  request,
  params,
}: CollectionHandlerArgs) => {
  const authorization = await authorizeSuperAdminRequest(request)
  if (!authorization.ok) {
    return authorization.response
  }

  if (!isReferenceDataDataset(params.dataset)) {
    return invalidDatasetResponse()
  }

  const url = new URL(request.url)
  const page = parsePositiveInteger(url.searchParams.get('page'), 1)
  const pageSize = Math.min(
    REFERENCE_DATA_MAX_PAGE_SIZE,
    parsePositiveInteger(
      url.searchParams.get('pageSize'),
      REFERENCE_DATA_DEFAULT_PAGE_SIZE,
    ),
  )
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200)

  try {
    return jsonResponse(
      await listReferenceDataRows(params.dataset, { q, page, pageSize }),
    )
  } catch (error) {
    return jsonResponse(
      { error: getErrorMessage(error) },
      { status: getReferenceDataErrorStatus(error) },
    )
  }
}

export const createReferenceDataHandler = async ({
  request,
  params,
}: CollectionHandlerArgs) => {
  const authorization = await authorizeSuperAdminRequest(request)
  if (!authorization.ok) {
    return authorization.response
  }

  if (!isReferenceDataDataset(params.dataset)) {
    return invalidDatasetResponse()
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return jsonResponse({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  try {
    const row = await createReferenceDataRow(params.dataset, body)
    await logAuditEvent(request, {
      eventType: 'reference_data_row_created',
      actorUserId: authorization.context.userId,
      targetId: `${params.dataset}:${row.id}`,
      targetType: 'reference_data',
      metadata: { dataset: params.dataset, rowId: row.id },
    }).catch(() => undefined)

    return jsonResponse({ row }, { status: 201 })
  } catch (error) {
    return jsonResponse(
      { error: getErrorMessage(error) },
      { status: getReferenceDataErrorStatus(error) },
    )
  }
}

export const Route = createFileRoute('/api/reference-data/$dataset' as never)({
  server: {
    handlers: {
      GET: listReferenceDataHandler,
      POST: createReferenceDataHandler,
    },
  },
})
