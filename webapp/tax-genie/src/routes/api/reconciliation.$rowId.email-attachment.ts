import { createFileRoute } from '@tanstack/react-router'

import {
  canAccessRoute,
  canExport,
  isAdmin,
  isEditor,
} from '@/lib/access-control'
import { buildReconciliationEmailAttachment } from '@/lib/reconciliation-email-server'
import {
  badRequestResponse,
  getErrorMessage,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const reconciliationEmailAttachmentHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { rowId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to download reconciliation email attachments.',
    )
  }

  if (!canAccessRoute('reconciliation', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to download reconciliation email attachments.',
    )
  }
  if (!isAdmin(context.role) && !isEditor(context.role)) {
    return unauthorizedResponse(
      'You do not have permission to download reconciliation email attachments.',
    )
  }
  if (!canExport.excel(context.role, context.canExportExcel)) {
    return unauthorizedResponse(
      'You do not have permission to export reconciliation workbooks.',
    )
  }

  const rowId = Number.parseInt(params.rowId, 10)
  if (!Number.isFinite(rowId)) {
    return badRequestResponse('Reconciliation row not found.')
  }

  try {
    const attachment = await buildReconciliationEmailAttachment(rowId)

    return new Response(attachment.content, {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': attachment.contentType,
        'content-disposition': `attachment; filename="${attachment.fileName}"`,
      },
    })
  } catch (error) {
    return badRequestResponse(getErrorMessage(error))
  }
}

export const Route = createFileRoute(
  '/api/reconciliation/$rowId/email-attachment',
)({
  server: {
    handlers: {
      GET: reconciliationEmailAttachmentHandler,
    },
  },
})
