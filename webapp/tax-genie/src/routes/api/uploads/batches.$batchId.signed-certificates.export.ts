import { Buffer } from 'node:buffer'

import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import { getSignedBatchCertificatesZipDownload } from '@/lib/signing-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const toAttachmentFileName = (fileName: string) =>
  fileName.replace(/[\\"]/g, '_') || 'Signed-Certificates.zip'

export const signedBatchCertificatesExportHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to download signed certificates.',
    )
  }

  if (
    !canAccessRoute('batches', context.role) ||
    !canAccessRoute('documents', context.role)
  ) {
    return unauthorizedResponse(
      'You do not have permission to view signed certificates.',
    )
  }

  if (!canExport.pdf(context.role, context.canExportPdf)) {
    return unauthorizedResponse(
      'You do not have permission to download signed certificate PDFs.',
    )
  }

  try {
    const download = await getSignedBatchCertificatesZipDownload({
      batchId: params.batchId,
      downloaderUserId: context.userId,
    })

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
      message === 'Upload batch not found.' ||
      message === 'No signed certificate PDFs were found for this batch.'
    ) {
      return jsonResponse({ error: message }, { status: 404 })
    }

    if (
      message ===
      'Close this upload batch before downloading signed certificates.'
    ) {
      return badRequestResponse(message)
    }

    return jsonResponse({ error: message }, { status: 500 })
  }
}

export const Route = createFileRoute(
  '/api/uploads/batches/$batchId/signed-certificates/export',
)({
  server: {
    handlers: {
      GET: signedBatchCertificatesExportHandler,
    },
  },
})
