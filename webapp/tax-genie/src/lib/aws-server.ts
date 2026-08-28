import { S3Client } from '@aws-sdk/client-s3'
import { BatchClient } from '@aws-sdk/client-batch'
import { LambdaClient } from '@aws-sdk/client-lambda'
import { SESClient } from '@aws-sdk/client-ses'
import { SQSClient } from '@aws-sdk/client-sqs'
import { getStorageObjectPrefix } from '@taxgenie/shared'

const DEFAULT_AWS_REGION = 'ap-southeast-1'

const readBucketName = (...keys: Array<string>) => {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) {
      return value
    }
  }

  return ''
}

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
    region:
      process.env.S3_REGION?.trim() ||
      process.env.AWS_REGION?.trim() ||
      DEFAULT_AWS_REGION,
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
  process.env.S3_REGION?.trim() ||
  process.env.AWS_REGION?.trim() ||
  DEFAULT_AWS_REGION

export const getStorageBucketName = () => {
  const bucket = readBucketName('S3_BUCKET_NAME')
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME is not configured.')
  }

  return bucket
}

export const getStoragePrefix = () => getStorageObjectPrefix(process.env)

export const getAllowedS3BucketNames = () => [getStorageBucketName()]

export const getQueueUrl = () => {
  const queueUrl = process.env.SQS_QUEUE_URL?.trim()
  if (!queueUrl) {
    throw new Error('SQS_QUEUE_URL is not configured')
  }

  return queueUrl
}

export const getMergeBatchJobQueue = () => {
  const queue = process.env.MERGE_BATCH_JOB_QUEUE?.trim()
  if (!queue) {
    throw new Error('MERGE_BATCH_JOB_QUEUE is not configured')
  }

  return queue
}

export const getMergeBatchJobDefinition = () => {
  const jobDefinition = process.env.MERGE_BATCH_JOB_DEFINITION?.trim()
  if (!jobDefinition) {
    throw new Error('MERGE_BATCH_JOB_DEFINITION is not configured')
  }

  return jobDefinition
}

export const getSesFromEmail = () => {
  const fromEmail =
    process.env.SES_FROM_EMAIL?.trim() ||
    process.env.TAXGENIE_SEED_EMAIL?.trim()

  if (!fromEmail) {
    throw new Error('SES_FROM_EMAIL is not configured')
  }

  return fromEmail
}

export const createS3ServerClient = () => new S3Client(buildAwsClientConfig())

export const createBatchServerClient = () =>
  new BatchClient({
    region: process.env.AWS_REGION?.trim() || getAwsRegion(),
    ...(buildAwsClientConfig().credentials
      ? { credentials: buildAwsClientConfig().credentials }
      : {}),
  })

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

export const createLambdaServerClient = () =>
  new LambdaClient({
    region: process.env.AWS_REGION?.trim() || getAwsRegion(),
    ...(buildAwsClientConfig().credentials
      ? { credentials: buildAwsClientConfig().credentials }
      : {}),
  })

export const getBatchRetentionFunctionName = () => {
  const functionName = process.env.BATCH_RETENTION_FUNCTION_NAME?.trim()
  if (!functionName) {
    throw new Error('BATCH_RETENTION_FUNCTION_NAME is not configured.')
  }

  return functionName
}

export const sanitizeUploadFileName = (fileName: string) => {
  const trimmed = fileName.trim()
  const lastSegment = trimmed.split(/[\\/]/).pop() || 'document.pdf'
  const sanitized = lastSegment.replace(/[^a-zA-Z0-9._-]/g, '_')
  return sanitized.length > 0 ? sanitized : 'document.pdf'
}
