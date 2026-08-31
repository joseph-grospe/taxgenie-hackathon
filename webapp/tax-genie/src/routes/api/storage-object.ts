import { Buffer } from 'node:buffer'

import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  getAllowedStorageBucketNames,
  getObjectStorage,
  getStorageBucketName,
} from '@/lib/cloud-server'
import {
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const toErrorPayload = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })

const handler = async ({ request }: { request: Request }) => {
  const context = await resolveContextFromRequest(request)
  if (!context) {
    return notAuthenticatedResponse(
      'Authentication is required for upload intake.',
    )
  }
  if (!canAccessRoute('upload', context.role)) {
    return unauthorizedResponse(
      'You do not have permission to view upload intake.',
    )
  }

  const url = new URL(request.url)
  const key = url.searchParams.get('key')?.trim() ?? ''
  const requestedBucket = url.searchParams.get('bucket')?.trim() ?? ''
  if (!key) {
    return toErrorPayload(400, 'Missing key query parameter')
  }

  let bucket = requestedBucket
  if (!bucket) {
    try {
      bucket = getStorageBucketName()
    } catch (error) {
      return toErrorPayload(
        500,
        error instanceof Error
          ? error.message
          : 'No storage bucket is configured for object preview',
      )
    }
  }
  if (!getAllowedStorageBucketNames().includes(bucket)) {
    return toErrorPayload(400, 'Requested bucket is not allowed')
  }

  try {
    const storage = getObjectStorage()
    const [metadata, bytes] = await Promise.all([
      storage.getMetadata({ bucket, key }),
      storage.read({ bucket, key }),
    ])
    const fileName = key.split('/').pop() ?? key
    return new Response(Buffer.from(bytes), {
      headers: {
        'content-type': metadata.contentType ?? 'application/pdf',
        'content-disposition': `inline; filename="${fileName}"`,
        'cache-control':
          'private, max-age=0, no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    return toErrorPayload(
      500,
      error instanceof Error ? error.message : 'Unable to load object',
    )
  }
}

export const Route = createFileRoute('/api/storage-object')({
  server: { handlers: { GET: handler } },
})
