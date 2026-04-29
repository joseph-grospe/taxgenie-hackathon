import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import { getUploadBatchById } from '@/lib/intake-server'
import { exportBatchReconciliationReport } from '@/lib/reconciliation-report-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const batchReconciliationExportHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to export batch reconciliation results.',
    )
  }

  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to export batch reconciliation results.',
    )
  }

  if (!canExport.excel(context.role, context.canExportExcel)) {
    return unauthorizedResponse(
      'You do not have permission to export reconciliation workbooks.',
    )
  }

  const batch = await getUploadBatchById({
    batchId: params.batchId,
    userId: context.userId,
  })

  if (batch.status === 'not_found') {
    return jsonResponse({ error: 'Upload batch not found.' }, { status: 404 })
  }

  if (batch.status === 'forbidden') {
    return unauthorizedResponse(
      'You do not have permission to export this upload batch.',
    )
  }

  try {
    const report = await exportBatchReconciliationReport(params.batchId)

    return new Response(report.content, {
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
  '/api/uploads/batches/$batchId/reconciliation/export',
)({
  server: {
    handlers: {
      GET: batchReconciliationExportHandler,
    },
  },
})
