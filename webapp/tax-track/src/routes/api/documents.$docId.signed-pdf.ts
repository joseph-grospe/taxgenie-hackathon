import { Buffer } from 'node:buffer'

import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import { getSignedCertificatePdfDownload } from '@/lib/signing-server'
import {
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const toAttachmentFileName = (fileName: string) =>
  fileName.replace(/[\\"]/g, '_') || 'signed-certificate.pdf'

export const signedCertificatePdfHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { docId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to download signed certificates.',
    )
  }

  if (!canAccessRoute('documents', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view document details.',
    )
  }

  if (!canExport.pdf(context.role, context.canExportPdf)) {
    return unauthorizedResponse(
      'You do not have permission to download signed certificate PDFs.',
    )
  }

  try {
    const download = await getSignedCertificatePdfDownload(params.docId)

    return new Response(Buffer.from(download.bytes), {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': download.contentType,
        'content-disposition': `attachment; filename="${toAttachmentFileName(
          download.fileName,
        )}"`,
      },
    })
  } catch (error) {
    const message = getErrorMessage(error)

    if (
      message === 'Certificate not found.' ||
      message === 'Signed certificate not found.' ||
      message === 'Signed PDF is not available for this certificate.'
    ) {
      return jsonResponse({ error: message }, { status: 404 })
    }

    return jsonResponse({ error: message }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/documents/$docId/signed-pdf')({
  server: {
    handlers: {
      GET: signedCertificatePdfHandler,
    },
  },
})
