import { z } from 'zod'

import type { intakeFiles } from '@/lib/schema'

type IntakeFileRecord = typeof intakeFiles.$inferSelect

export const uploadCreateSchema = z.object({
  batchId: z.string().uuid().optional(),
  entityId: z.number().int().positive().optional(),
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

export type UploadFileInput = z.infer<
  typeof uploadCreateSchema
>['files'][number]

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
  if (file.queueStatus === 'queued' || file.queueStatus === 'sending')
    return 'queued'
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
