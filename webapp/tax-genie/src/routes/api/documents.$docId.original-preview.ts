import { Buffer } from 'node:buffer'

import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { getOriginalDocumentFileDownload } from '@/lib/issue-files-server'
import {
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const toInlineFileName = (fileName: string) =>
  fileName.replace(/[\\"]/g, '_') || 'original-file.pdf'

export const originalDocumentPreviewHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { docId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to preview original document files.',
    )
  }

  if (!canAccessRoute('documents', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view document details.',
    )
  }

  try {
    const preview = await getOriginalDocumentFileDownload(params.docId)

    return new Response(Buffer.from(preview.bytes), {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': preview.contentType,
        'content-disposition': `inline; filename="${toInlineFileName(
          preview.fileName,
        )}"`,
      },
    })
  } catch (error) {
    const message = getErrorMessage(error)

    if (
      message === 'Document not found.' ||
      message === 'Original file not found.'
    ) {
      return jsonResponse({ error: message }, { status: 404 })
    }

    return jsonResponse({ error: message }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/documents/$docId/original-preview')({
  server: {
    handlers: {
      GET: originalDocumentPreviewHandler,
    },
  },
})
