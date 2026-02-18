import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { createFileRoute } from '@tanstack/react-router'
import type { _Object } from '@aws-sdk/client-s3'

type IngestionFileEvent = {
  id: string
  at: string
  type: string
  detail: string
  enqueued: number | string
  status: string
}

type IntakeStatus = {
  source: string
  folder: {
    name: string
    id: string
  }
  ingestion: {
    status: string
    webhookHealth: string
    lastSyncAt: string
    channelExpiresAt: string
  }
  backfill: {
    status: string
    startedAt: string
    finishedAt: string
    imported: number
    processed: number
    queued: number
    errors: number
    duplicates: number
  }
}

type S3IntakePayload = {
  status: IntakeStatus
  events: Array<IngestionFileEvent>
  debug?: {
    bucket: string
    region: string
    prefix: string
    maxKeys: number
    objectCount: number
    sampleKeys: Array<string>
    queriedAt: string
  }
}

const FILE_METADATA_CACHE_TTL_MS = 0
const FALLBACK_NAME = 'n/a'
const S3_DEFAULT_MAX_KEYS = 20
const DEFAULT_AWS_REGION = 'ap-southeast-1'

const safeToLocale = (value: string) => {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return FALLBACK_NAME
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

type S3ObjectMetadata = {
  key: string
  lastModified: string
  size: string
  etag: string
  storageClass: string
}

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

const toObjectMetadata = (object: _Object | undefined): S3ObjectMetadata => {
  return {
    key: object?.Key?.trim() || FALLBACK_NAME,
    lastModified: object?.LastModified?.toISOString() || FALLBACK_NAME,
    size: String(object?.Size ?? 0),
    etag: object?.ETag?.trim() || FALLBACK_NAME,
    storageClass: object?.StorageClass || FALLBACK_NAME,
  }
}

const fileExtensionType = (key: string) => {
  const lastSegment = key.split('/').slice(-1)[0] ?? ''
  const extension = lastSegment.includes('.')
    ? lastSegment.split('.').slice(-1)[0]?.toUpperCase()
    : null

  if (!extension) {
    return 'n/a'
  }

  return extension
}

const loadS3Objects = async () => {
  const bucketName = process.env.S3_BUCKET_NAME?.trim() || ''
  const region = process.env.S3_REGION?.trim() || DEFAULT_AWS_REGION
  const prefix = process.env.S3_PREFIX?.trim() || undefined
  const parsedMaxKeys = Number.parseInt(
    process.env.S3_MAX_KEYS ?? String(S3_DEFAULT_MAX_KEYS),
    10,
  )
  const maxKeys = Number.isNaN(parsedMaxKeys)
    ? S3_DEFAULT_MAX_KEYS
    : parsedMaxKeys

  if (!bucketName) {
    throw new Error('S3_BUCKET_NAME is not configured')
  }

  const client = buildS3Client(region)
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: maxKeys,
    }),
  )

  return (response.Contents ?? []).map(toObjectMetadata)
}

const resolveS3Config = () => {
  const bucketName = process.env.S3_BUCKET_NAME?.trim() || ''
  const region = process.env.S3_REGION?.trim() || DEFAULT_AWS_REGION
  const prefix = process.env.S3_PREFIX?.trim() || ''
  const parsedMaxKeys = Number.parseInt(
    process.env.S3_MAX_KEYS ?? String(S3_DEFAULT_MAX_KEYS),
    10,
  )
  const maxKeys = Number.isNaN(parsedMaxKeys)
    ? S3_DEFAULT_MAX_KEYS
    : parsedMaxKeys

  return {
    bucketName,
    region,
    prefix: prefix || '(root)',
    maxKeys,
  }
}

const buildDebugPayload = (
  objects: Array<S3ObjectMetadata>,
  queriedAt: string,
): {
  bucket: string
  region: string
  prefix: string
  maxKeys: number
  objectCount: number
  sampleKeys: Array<string>
  queriedAt: string
} => {
  const config = resolveS3Config()

  return {
    bucket: config.bucketName || FALLBACK_NAME,
    region: config.region,
    prefix: config.prefix,
    maxKeys: config.maxKeys,
    objectCount: objects.length,
    sampleKeys: objects
      .slice(0, 10)
      .map((object) => object.key)
      .filter((key) => key.length > 0 && key !== FALLBACK_NAME),
    queriedAt,
  }
}

const toErrorPayload = (error: unknown): S3IntakePayload & { error: string } => {
  const now = new Date().toLocaleString()
  const message =
    error instanceof Error ? error.message : 'Unknown S3 polling failure'

  return {
    status: {
      source: 'AWS S3',
      folder: {
        name: process.env.S3_BUCKET_NAME?.trim() || FALLBACK_NAME,
        id: process.env.S3_BUCKET_NAME?.trim() || FALLBACK_NAME,
      },
      ingestion: {
        status: 'Inactive',
        webhookHealth: 'n/a',
        lastSyncAt: now,
        channelExpiresAt: 'n/a',
      },
      backfill: {
        status: 'Error',
        startedAt: now,
        finishedAt: now,
        imported: 0,
        processed: 0,
        queued: 0,
        errors: 1,
        duplicates: 0,
      },
    },
    events: [],
    debug: buildDebugPayload([], now),
    error: message,
  }
}

const toDriveStyleEvents = (objects: Array<S3ObjectMetadata>) => {
  return objects.map((item, index) => {
    const key = item.key
    const lastModified = item.lastModified
    const size = Number.parseInt(item.size, 10) || 0
    const storageClass = item.storageClass
    const etag = item.etag

    return {
      id: key || `object-${index}`,
      at: safeToLocale(lastModified),
      type: fileExtensionType(key),
      detail: `StorageClass: ${storageClass} • ETag: ${etag}`,
      enqueued: size,
      status: size > 0 ? 'Ready' : 'n/a',
    }
  })
}

const getCachedPayload = (): S3IntakePayload => {
  const now = new Date().toLocaleString()
  const debug = buildDebugPayload([], now)
  const bucketLabel = debug.bucket

  return {
    status: {
      source: 'AWS S3',
      folder: {
        name: bucketLabel,
        id: bucketLabel,
      },
      ingestion: {
        status: 'Active',
        webhookHealth: 'n/a',
        lastSyncAt: now,
        channelExpiresAt: 'n/a',
      },
      backfill: {
        status: 'Done',
        startedAt: now,
        finishedAt: now,
        imported: 0,
        processed: 0,
        queued: 0,
        errors: 0,
        duplicates: 0,
      },
    },
    events: [],
    debug,
  }
}

const handler = async () => {
  const started = Date.now()
  try {
    const payload = getCachedPayload()
    const objects = await loadS3Objects()
    const events = toDriveStyleEvents(objects)
    const syncAt = new Date().toLocaleString()
    const imported = events.length

    payload.status.ingestion.lastSyncAt = syncAt
    payload.status.backfill = {
      ...payload.status.backfill,
      imported,
      processed: imported,
      finishedAt: syncAt,
      startedAt: syncAt,
    }
    payload.events = events
    payload.debug = buildDebugPayload(objects, syncAt)

    const elapsed = Date.now() - started

    return new Response(JSON.stringify(payload), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-poll-ms': String(elapsed),
        'x-cache-ttl-ms': String(FILE_METADATA_CACHE_TTL_MS),
      },
    })
  } catch (error) {
    const elapsed = Date.now() - started
    const payload = toErrorPayload(error)

    console.error('S3 listing failed in API route', error)

    return new Response(JSON.stringify(payload), {
      status: 500,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-poll-ms': String(elapsed),
        'x-cache-ttl-ms': String(FILE_METADATA_CACHE_TTL_MS),
      },
    })
  }

}

export const Route = createFileRoute('/api/s3-events')({
  server: {
    handlers: { GET: handler },
  },
})
