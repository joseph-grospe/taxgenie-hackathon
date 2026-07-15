import { Buffer } from 'node:buffer'

import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute, canExport } from '@/lib/access-control'
import { logAuditEvent } from '@/lib/audit'
import {
  ISSUE_FILE_DOWNLOAD_FALLBACK_FILE_NAME,
  ISSUE_FILE_DOWNLOAD_MAX_FILES,
  ISSUE_FILE_DOWNLOAD_MAX_SIZE_LABEL,
  getIssueFilesZipDownload,
  toIssueFileDownloadLimitMessage,
  toIssueFileDownloadSizeLimitMessage,
} from '@/lib/issue-files-server'
import { parseEntityFilterIdInput } from '@/lib/entities-server'
import {
  badRequestResponse,
  getErrorMessage,
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'
import {
  getIssueDocumentAuditFilters,
  getIssueDocumentListOptions,
} from '@/routes/api/documents/issues'

const toAttachmentFileName = (fileName: string) =>
  fileName.replace(/[\\"]/g, '_') || ISSUE_FILE_DOWNLOAD_FALLBACK_FILE_NAME

export const issueDocumentFilesHandler = async ({
  request,
}: {
  request: Request
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to download document issue files.',
    )
  }

  if (!canAccessRoute('issues', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view document issues.',
    )
  }

  if (!canExport.pdf(context.role, context.canExportPdf)) {
    return unauthorizedResponse(
      'You do not have permission to download document issue files.',
    )
  }

  try {
    parseEntityFilterIdInput(new URL(request.url).searchParams.get('entityId'))

    const options = getIssueDocumentListOptions(request, {
      includePagination: false,
    })
    const download = await getIssueFilesZipDownload(options)

    await logAuditEvent(request, {
      actorUserId: context.userId,
      eventType: 'issues_exported',
      metadata: {
        format: 'zip',
        filters: getIssueDocumentAuditFilters(request),
        fileCount: download.fileCount,
        totalSizeBytes: download.totalSizeBytes,
      },
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
      message === toIssueFileDownloadLimitMessage(ISSUE_FILE_DOWNLOAD_MAX_FILES)
    ) {
      return badRequestResponse(message)
    }

    if (
      message ===
      toIssueFileDownloadSizeLimitMessage(ISSUE_FILE_DOWNLOAD_MAX_SIZE_LABEL)
    ) {
      return badRequestResponse(message)
    }

    if (message === 'No original issue files matched the current filters.') {
      return jsonResponse({ error: message }, { status: 404 })
    }

    if (message.startsWith('Original file not found for ')) {
      return jsonResponse({ error: message }, { status: 404 })
    }

    if (message === 'Invalid entity filter.') {
      return badRequestResponse(message)
    }

    return jsonResponse({ error: message }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/documents/issues/files')({
  server: {
    handlers: {
      GET: issueDocumentFilesHandler,
    },
  },
})
