import { createManilaDateFormatter } from '@/lib/manila-time'

const PAGE_LAST_UPDATED_FORMATTER = createManilaDateFormatter('en-US', {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const ACTIVE_LOCAL_UPLOAD_STATUSES = new Set([
  'Pending',
  'Requesting',
  'Uploading',
  'Queueing',
  'Queued',
  'Processing',
])

type BatchProcessingCounts = {
  pending?: number | null
  uploaded?: number | null
  queued?: number | null
  processing?: number | null
}

type BatchProcessingState = {
  counts?: BatchProcessingCounts | null
} | null

export const formatPageLastUpdated = (
  value: Date | string | null | undefined,
) => {
  if (!value) return 'Not updated yet'

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Not updated yet'
    : PAGE_LAST_UPDATED_FORMATTER.format(date)
}

export const hasActiveLocalUploads = (
  localFiles: Array<{ status: string }>,
) => localFiles.some((file) => ACTIVE_LOCAL_UPLOAD_STATUSES.has(file.status))

export const hasActiveBatchProcessing = (batch: BatchProcessingState) => {
  const counts = batch?.counts
  if (!counts) return false

  return (
    (counts.pending ?? 0) > 0 ||
    (counts.uploaded ?? 0) > 0 ||
    (counts.queued ?? 0) > 0 ||
    (counts.processing ?? 0) > 0
  )
}

export const shouldPollUploadIntake = ({
  activeBatch,
  localFiles,
}: {
  activeBatch: BatchProcessingState
  localFiles: Array<{ status: string }>
}) => hasActiveLocalUploads(localFiles) || hasActiveBatchProcessing(activeBatch)

export const shouldPollBatchDetail = (batch: BatchProcessingState) =>
  hasActiveBatchProcessing(batch)
