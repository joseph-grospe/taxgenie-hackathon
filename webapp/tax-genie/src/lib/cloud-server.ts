import {
  GoogleCloudObjectStorage,
  getStorageObjectPrefix,
  type ObjectStorage,
} from '@taxgenie/shared'

const DEFAULT_GCP_REGION = 'asia-southeast1'

let storage: ObjectStorage | undefined

export const getGcpRegion = () =>
  process.env.GCP_REGION?.trim() || DEFAULT_GCP_REGION

export const getStorageBucketName = () => {
  const bucket = process.env.STORAGE_BUCKET_NAME?.trim()
  if (!bucket) {
    throw new Error('STORAGE_BUCKET_NAME is not configured.')
  }
  return bucket
}

export const getStoragePrefix = () => getStorageObjectPrefix(process.env)

export const getAllowedStorageBucketNames = () => [getStorageBucketName()]

export const getObjectStorage = (): ObjectStorage => {
  if (!storage) {
    storage = new GoogleCloudObjectStorage()
  }
  return storage
}

export const sanitizeUploadFileName = (fileName: string) => {
  const trimmed = fileName.trim()
  const lastSegment = trimmed.split(/[\\/]/).pop() || 'document.pdf'
  const sanitized = lastSegment.replace(/[^a-zA-Z0-9._-]/g, '_')
  return sanitized.length > 0 ? sanitized : 'document.pdf'
}
