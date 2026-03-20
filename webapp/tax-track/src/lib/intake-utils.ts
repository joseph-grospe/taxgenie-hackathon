import { z } from 'zod'

import { intakeFiles } from '@/lib/schema'

type IntakeFileRecord = typeof intakeFiles.$inferSelect

export const uploadBatchCreateSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.string().min(1),
        size: z.number().int().positive(),
      }),
    )
    .min(1),
})

export type UploadFileInput = z.infer<typeof uploadBatchCreateSchema>['files'][number]

export const isPdfFileUpload = (file: { name: string; type: string }) => {
  const fileName = file.name.toLowerCase()
  const mimeType = file.type.toLowerCase()
  return mimeType === 'application/pdf' || fileName.endsWith('.pdf')
}

export const resolveOverallStatus = (file: IntakeFileRecord) => {
  if (file.processingStatus === 'success') return 'success'
  if (file.processingStatus === 'duplicate') return 'duplicate'
  if (file.processingStatus === 'error') return 'error'
  if (file.processingStatus === 'processing') return 'processing'
  if (file.queueStatus === 'failed') return 'error'
  if (file.queueStatus === 'queued' || file.queueStatus === 'sending') return 'queued'
  if (file.uploadStatus === 'uploaded') return 'uploaded'
  return 'pending'
}

export const computeCounts = (files: Array<{ overallStatus: string }>) => {
  const counts: Record<string, number> = {
    pending: 0,
    uploaded: 0,
    queued: 0,
    processing: 0,
    success: 0,
    duplicate: 0,
    error: 0,
  }

  for (const file of files) {
    counts[file.overallStatus] = (counts[file.overallStatus] ?? 0) + 1
  }

  return counts
}

export const deriveBatchStatus = (files: Array<IntakeFileRecord>) => {
  if (files.length === 0) {
    return 'pending'
  }

  const totals = files.reduce(
    (acc, file) => {
      if (file.processingStatus === 'processing') acc.processing += 1
      if (file.processingStatus === 'success') acc.success += 1
      if (file.processingStatus === 'duplicate') acc.duplicate += 1
      if (file.processingStatus === 'error' || file.queueStatus === 'failed') acc.error += 1
      if (file.queueStatus === 'queued' || file.queueStatus === 'sending') acc.queued += 1
      if (file.uploadStatus !== 'uploaded') acc.pending += 1
      return acc
    },
    {
      pending: 0,
      queued: 0,
      processing: 0,
      success: 0,
      duplicate: 0,
      error: 0,
    },
  )

  const completed = totals.success + totals.duplicate + totals.error
  if (completed === files.length) {
    return totals.error > 0 ? 'completed_with_errors' : 'completed'
  }

  if (totals.processing > 0) {
    return 'processing'
  }

  if (totals.queued > 0) {
    return 'queued'
  }

  return 'pending'
}
