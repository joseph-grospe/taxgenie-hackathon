import { Buffer } from 'node:buffer'

import { GetObjectCommand } from '@aws-sdk/client-s3'
import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { createS3ServerClient } from '@/lib/aws-server'
import { parseSalesReportDetailSearch } from '@/lib/sales-report-detail-search-state'
import {
  deleteSalesReport,
  getSalesReportDetail,
  getSalesReportOriginalObject,
  salesReportUpdateSchema,
  updateSalesReport,
} from '@/lib/sales-report-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  parseJsonBodyWithDetails,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const parsePositiveInteger = (value: string | null) => {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export const salesReportDetailHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { reportId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view sales reports.',
    )
  }

  if (!canAccessRoute('reconciliation', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view sales reports.',
    )
  }

  const url = new URL(request.url)
  const search = parseSalesReportDetailSearch(
    Object.fromEntries(url.searchParams),
  )
  if (url.searchParams.get('download') === 'original') {
    const object = await getSalesReportOriginalObject(params.reportId)
    if (!object) {
      return jsonResponse({ error: 'Sales report not found.' }, { status: 404 })
    }

    try {
      const response = await createS3ServerClient().send(
        new GetObjectCommand({
          Bucket: object.storageBucket,
          Key: object.storageKey,
        }),
      )
      const body = response.Body as
        | { transformToByteArray?: () => Promise<Uint8Array> }
        | undefined

      if (!body?.transformToByteArray) {
        throw new Error('Unexpected object body format.')
      }

      return new Response(Buffer.from(await body.transformToByteArray()), {
        headers: {
          'cache-control': 'private, no-store',
          'content-type': object.mimeType,
          'content-disposition': `attachment; filename="${object.sanitizedFileName}"`,
        },
      })
    } catch (error) {
      return badRequestResponse(getErrorMessage(error))
    }
  }

  const detail = await getSalesReportDetail(params.reportId, {
    rowsQ: search.rowsQ,
    rowsPage: search.rowsPage,
    rowsPageSize: search.rowsPageSize,
    q: search.q,
    filter: search.filter,
    resultsPage:
      parsePositiveInteger(url.searchParams.get('resultsPage')) ?? search.page,
    resultsPageSize:
      parsePositiveInteger(url.searchParams.get('resultsPageSize')) ??
      search.pageSize,
  })
  if (!detail) {
    return jsonResponse({ error: 'Sales report not found.' }, { status: 404 })
  }

  return jsonResponse({ report: detail })
}

export const salesReportUpdateHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { reportId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to update sales reports.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to update sales reports.',
    )
  }

  const parsed = await parseJsonBodyWithDetails(
    request,
    salesReportUpdateSchema,
  )
  if (!parsed.ok) {
    return badRequestResponse(parsed.error)
  }

  try {
    const report = await updateSalesReport({
      reportId: params.reportId,
      name: parsed.data.name,
    })

    if (!report) {
      return jsonResponse({ error: 'Sales report not found.' }, { status: 404 })
    }

    return jsonResponse({ report })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const salesReportDeleteHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { reportId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to delete sales reports.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to delete sales reports.',
    )
  }

  const deleted = await deleteSalesReport({
    reportId: params.reportId,
    userId: context.userId,
  })

  if (!deleted) {
    return jsonResponse({ error: 'Sales report not found.' }, { status: 404 })
  }

  return jsonResponse({ deleted: true })
}

export const Route = createFileRoute('/api/sales-reports/$reportId')({
  server: {
    handlers: {
      GET: salesReportDetailHandler,
      PATCH: salesReportUpdateHandler,
      DELETE: salesReportDeleteHandler,
    },
  },
})
