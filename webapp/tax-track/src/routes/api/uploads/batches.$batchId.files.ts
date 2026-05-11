import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import { parseBatchFilesSearch } from '@/lib/batch-file-search-state'
import { listUploadBatchFiles } from '@/lib/intake-server'
import {
  jsonResponse,
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

export const uploadBatchFilesHandler = async ({
  request,
  params,
}: {
  request: Request
  params: { batchId: string }
}) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required to view batch files.',
    )
  }

  if (!canAccessRoute('batches', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view batch files.',
    )
  }

  const url = new URL(request.url)
  const search = parseBatchFilesSearch(Object.fromEntries(url.searchParams))
  const result = await listUploadBatchFiles({
    batchId: params.batchId,
    ...search,
  })

  if (result.status === 'not_found') {
    return jsonResponse({ error: 'Upload batch not found.' }, { status: 404 })
  }

  return jsonResponse(result.result)
}

export const Route = createFileRoute('/api/uploads/batches/$batchId/files')({
  server: {
    handlers: {
      GET: uploadBatchFilesHandler,
    },
  },
})
