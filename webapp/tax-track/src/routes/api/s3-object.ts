import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createFileRoute } from '@tanstack/react-router'

import { canAccessRoute } from '@/lib/access-control'
import {
  notAuthenticatedResponse,
  resolveContextFromRequest,
  unauthorizedResponse,
} from '@/lib/user-admin-server'

const FALLBACK_NAME = 'n/a'
const DEFAULT_AWS_REGION = 'ap-southeast-1'

const buildS3Client = (region: string) => {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim()
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim()
  const hasAccessKey = Boolean(accessKeyId)
  const hasSecretKey = Boolean(secretAccessKey)
  const hasSessionToken = Boolean(sessionToken)

  const clientConfig = { region: region || DEFAULT_AWS_REGION } as {
    region: string
    credentials?: {
      accessKeyId: string
      secretAccessKey: string
      sessionToken?: string
    }
  }

  if (hasAccessKey && hasSecretKey) {
    clientConfig.credentials = {
      accessKeyId,
      secretAccessKey,
      ...(hasSessionToken ? { sessionToken: sessionToken ?? undefined } : {}),
    }
  }

  return new S3Client(clientConfig)
}

const toErrorPayload = (status: number, message: string) =>
  new Response(
    JSON.stringify({
      error: message,
    }),
    {
      status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    },
  )

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

  if (key.length === 0) {
    return toErrorPayload(400, 'Missing key query parameter')
  }

  const bucket = process.env.S3_BUCKET_NAME?.trim() || FALLBACK_NAME
  const region = process.env.S3_REGION?.trim() || DEFAULT_AWS_REGION

  if (bucket === FALLBACK_NAME) {
    return toErrorPayload(500, 'S3_BUCKET_NAME is not configured')
  }

  const client = buildS3Client(region)

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    )

    if (!response.Body) {
      return toErrorPayload(404, 'Object body was empty')
    }

    const bodyTransformer = response.Body as {
      transformToByteArray?: () => Promise<Uint8Array>
    }

    if (!bodyTransformer?.transformToByteArray) {
      return toErrorPayload(500, 'Unexpected object body format')
    }

    const bytes = await bodyTransformer.transformToByteArray()

    const fileType = response.ContentType ?? 'application/pdf'
    const fileName = key.split('/').pop() ?? key

    return new Response(bytes, {
      headers: {
        'content-type': fileType,
        'content-disposition': `inline; filename="${fileName}"`,
        'cache-control':
          'private, max-age=0, no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    if (error instanceof Error) {
      return toErrorPayload(500, error.message)
    }

    return toErrorPayload(500, 'Unable to load object from S3')
  }
}

export const Route = createFileRoute('/api/s3-object')({
  server: {
    handlers: { GET: handler },
  },
})
