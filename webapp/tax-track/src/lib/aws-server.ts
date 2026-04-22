import { S3Client } from '@aws-sdk/client-s3'
import { SESClient } from '@aws-sdk/client-ses'
import { SQSClient } from '@aws-sdk/client-sqs'

const DEFAULT_AWS_REGION = 'ap-southeast-1'

type AwsClientConfig = {
  region: string
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
}

const buildAwsClientConfig = (): AwsClientConfig => {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim()
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim()

  const config: AwsClientConfig = {
    region: process.env.S3_REGION?.trim() || process.env.AWS_REGION?.trim() || DEFAULT_AWS_REGION,
  }

  if (accessKeyId && secretAccessKey) {
    config.credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    }
  }

  return config
}

export const getAwsRegion = () =>
  process.env.S3_REGION?.trim() || process.env.AWS_REGION?.trim() || DEFAULT_AWS_REGION

export const getSourceBucketName = () => {
  const bucket = process.env.S3_BUCKET_NAME?.trim()
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME is not configured')
  }

  return bucket
}

export const getQueueUrl = () => {
  const queueUrl = process.env.SQS_QUEUE_URL?.trim()
  if (!queueUrl) {
    throw new Error('SQS_QUEUE_URL is not configured')
  }

  return queueUrl
}

export const getSesFromEmail = () => {
  const fromEmail =
    process.env.SES_FROM_EMAIL?.trim() || process.env.TAXTRACK_SEED_EMAIL?.trim()

  if (!fromEmail) {
    throw new Error('SES_FROM_EMAIL is not configured')
  }

  return fromEmail
}

export const createS3ServerClient = () => new S3Client(buildAwsClientConfig())

export const createSqsServerClient = () =>
  new SQSClient({
    region: process.env.AWS_REGION?.trim() || getAwsRegion(),
    ...(buildAwsClientConfig().credentials
      ? { credentials: buildAwsClientConfig().credentials }
      : {}),
  })

export const createSesServerClient = () =>
  new SESClient({
    region: process.env.AWS_REGION?.trim() || getAwsRegion(),
    ...(buildAwsClientConfig().credentials
      ? { credentials: buildAwsClientConfig().credentials }
      : {}),
  })

export const sanitizeUploadFileName = (fileName: string) => {
  const trimmed = fileName.trim()
  const lastSegment = trimmed.split(/[\\/]/).pop() || 'document.pdf'
  const sanitized = lastSegment.replace(/[^a-zA-Z0-9._-]/g, '_')
  return sanitized.length > 0 ? sanitized : 'document.pdf'
}
