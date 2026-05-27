import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import {
  exportReconciliationReport,
  isValidReconciliationExportPeriod,
} from '@/lib/reconciliation-report-server'
import {
  badRequestResponse,
  getErrorMessage,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const reconciliationExportHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to export reconciliation results.',
    )
  }

  if (!canAccessRoute('reconciliation', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to export reconciliation results.',
    )
  }

  if (!canExport.excel(context.role, context.canExportExcel)) {
    return unauthorizedResponse(
      'You do not have permission to export reconciliation workbooks.',
    )
  }

  const { searchParams } = new URL(request.url)
  const granularity = searchParams.get('granularity')
  const periodValue = searchParams.get('periodValue')?.trim() ?? ''
  const entityId = searchParams.get('entityId')?.trim() ?? ''

  if (granularity !== 'monthly' && granularity !== 'quarterly') {
    return badRequestResponse(
      'Export granularity must be either monthly or quarterly.',
    )
  }

  if (!periodValue || !isValidReconciliationExportPeriod(granularity, periodValue)) {
    return badRequestResponse('A valid export period is required.')
  }

  try {
    const report = await exportReconciliationReport(granularity, periodValue, {
      entityId,
    })

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

export const Route = createFileRoute('/api/reconciliation/export')({
  server: {
    handlers: {
      GET: reconciliationExportHandler,
    },
  },
})
