import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport2307Workbook } from '@/lib/access-control'
import { exportBatchBir2307Report } from '@/lib/bir2307-export-server'
import { getUploadBatchById } from '@/lib/intake-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const batchBir2307ExportHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to export extracted 2307 data.',
    )
  }

  if (!canExport2307Workbook(context)) {
    if (!canAccessRoute('upload', context.role)) {
      return unauthorizedResponse(
        'You do not have permission to export extracted 2307 data.',
      )
    }

    return unauthorizedResponse(
      'You do not have permission to export 2307 workbooks.',
    )
  }

  const batch = await getUploadBatchById({
    batchId: params.batchId,
  })

  const batchStatus: string = batch.status

  if (batchStatus === 'forbidden') {
    return unauthorizedResponse(
      'You do not have permission to export this upload batch.',
    )
  }

  if (batchStatus === 'not_found' || !batch.batch) {
    return jsonResponse({ error: 'Upload batch not found.' }, { status: 404 })
  }

  if (batch.batch.status !== 'closed') {
    return badRequestResponse(
      'Close this upload batch before exporting extracted 2307 data.',
    )
  }

  try {
    const report = await exportBatchBir2307Report(params.batchId)

    return new Response(report.content as unknown as BodyInit, {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${report.fileName}"`,
      },
    })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute(
  '/api/uploads/batches/$batchId/bir2307/export',
)({
  server: {
    handlers: {
      GET: batchBir2307ExportHandler,
    },
  },
})
