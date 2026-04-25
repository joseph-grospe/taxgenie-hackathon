import { randomUUID } from 'node:crypto'

import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  QueueMessageSchema,
  buildCertificateMetadataFields,
} from '@taxtrack/shared'
import { desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import type {
  IntakeUploadResultSummary,
  IntakeUploadView,
} from '@/lib/upload-intake-types'
import type { UploadFileInput } from '@/lib/intake-utils'
import {
  createS3ServerClient,
  createSqsServerClient,
  getAwsRegion,
  getQueueUrl,
  getSourceBucketName,
  sanitizeUploadFileName,
} from '@/lib/aws-server'
import { getDb } from '@/lib/db'
import {
  isPdfFileUpload,
  resolveOverallStatus,
  uploadCreateSchema,
} from '@/lib/intake-utils'
import { documentResults, intakeFiles, workerJobs } from '@/lib/schema'

const PRESIGN_EXPIRY_SECONDS = 60 * 15

const statusKeys = [
  'pending',
  'uploaded',
  'queued',
  'processing',
  'success',
  'duplicate',
  'error',
] as const

export const completeUploadSchema = z.object({
  uploadId: z.string().uuid(),
})

export const resolveUploadAttentionSchema = z.object({
  uploadId: z.string().uuid(),
})

type IntakeFileRecord = typeof intakeFiles.$inferSelect
type WorkerJobRecord = typeof workerJobs.$inferSelect
type DocumentResultRecord = typeof documentResults.$inferSelect

export type IntakeStatusKey = (typeof statusKeys)[number]

export type IntakeStatusSummary = Record<IntakeStatusKey, number>

const toIsoString = (value: Date | null | undefined) =>
  value?.toISOString() ?? null

const toReasonCodes = (value: unknown): Array<string> => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

const toNumberValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {}

const toNumberArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === 'number' && Number.isFinite(item),
      )
    : []

const parseUploadResultSummary = (
  results: Array<DocumentResultRecord>,
): IntakeUploadResultSummary | null => {
  const summaryRecord = results
    .map((result) => toRecord(toRecord(result.payload).batchSummary))
    .find((summary) => (toNumberValue(summary.totalPages) ?? 0) > 0)

  if (summaryRecord) {
    const detected = toNumberArray(summaryRecord.certificatePageNumbers).length
    const validated = toNumberArray(summaryRecord.validPageNumbers).length
    const skipped = toNumberArray(summaryRecord.ignoredPageNumbers).length
    const failed = toNumberArray(summaryRecord.failedPageNumbers).length
    const duplicates = toNumberArray(summaryRecord.duplicatePageNumbers).length

    return {
      detected,
      validated,
      skipped,
      needsReview: failed + duplicates,
      totalPages: toNumberValue(summaryRecord.totalPages),
      source: 'batch_summary',
    }
  }

  const certificateResults = results.filter(
    (result) => result.documentKind === 'certificate',
  )
  if (certificateResults.length === 0) {
    return null
  }

  return {
    detected: certificateResults.length,
    validated: certificateResults.filter(
      (result) => result.status === 'success',
    ).length,
    skipped: null,
    needsReview: certificateResults.filter(
      (result) => result.status !== 'success',
    ).length,
    totalPages: null,
    source: 'results',
  }
}

const emptyStatusSummary = (): IntakeStatusSummary => ({
  pending: 0,
  uploaded: 0,
  queued: 0,
  processing: 0,
  success: 0,
  duplicate: 0,
  error: 0,
})

const hasOpenAttention = (upload: {
  overallStatus: string
  attentionStatus?: 'open' | 'resolved'
}) =>
  ['duplicate', 'error'].includes(upload.overallStatus) &&
  upload.attentionStatus !== 'resolved'

const toStatusSummary = (
  uploads: Array<{
    overallStatus: string
    attentionStatus?: 'open' | 'resolved'
  }>,
): IntakeStatusSummary => {
  const counts = emptyStatusSummary()

  for (const upload of uploads) {
    switch (upload.overallStatus) {
      case 'duplicate':
      case 'error':
        if (hasOpenAttention(upload)) {
          counts[upload.overallStatus] += 1
        }
        break
      case 'pending':
      case 'uploaded':
      case 'queued':
      case 'processing':
      case 'success':
        counts[upload.overallStatus] += 1
        break
      default:
        break
    }
  }

  return counts
}

const buildStorageKey = (uploadId: string, fileName: string) =>
  `uploads/${uploadId}/${sanitizeUploadFileName(fileName)}`

const mapUploadViews = (
  files: Array<IntakeFileRecord>,
  jobs: Array<WorkerJobRecord>,
  results: Array<DocumentResultRecord>,
) => {
  const latestJobByUpload = new Map<string, WorkerJobRecord>()
  for (const job of jobs) {
    if (!latestJobByUpload.has(job.uploadId)) {
      latestJobByUpload.set(job.uploadId, job)
    }
  }

  const latestResultByUpload = new Map<string, DocumentResultRecord>()
  const resultsByUpload = new Map<string, Array<DocumentResultRecord>>()
  for (const result of results) {
    if (!latestResultByUpload.has(result.uploadId)) {
      latestResultByUpload.set(result.uploadId, result)
    }

    const current = resultsByUpload.get(result.uploadId) ?? []
    current.push(result)
    resultsByUpload.set(result.uploadId, current)
  }

  return files.map<IntakeUploadView>((file) => {
    const latestJob = latestJobByUpload.get(file.id) ?? null
    const latestResult = latestResultByUpload.get(file.id) ?? null
    const relatedResults = resultsByUpload.get(file.id) ?? []

    return {
      id: file.id,
      fileName: file.originalFileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadStatus: file.uploadStatus,
      queueStatus: file.queueStatus,
      processingStatus: file.processingStatus,
      overallStatus: resolveOverallStatus(file),
      attentionStatus:
        file.attentionStatus === 'resolved' ? 'resolved' : 'open',
      attentionResolvedAt: toIsoString(file.attentionResolvedAt),
      currentPhase: latestJob?.currentPhase ?? file.currentPhase,
      currentStep: latestJob?.currentStep ?? file.currentStep,
      errorMessage: latestJob?.errorSummary ?? file.errorMessage,
      uploadedAt: toIsoString(file.uploadedAt),
      queuedAt: toIsoString(file.queuedAt),
      processingStartedAt: toIsoString(file.processingStartedAt),
      processingFinishedAt: toIsoString(file.processingFinishedAt),
      storageKey: file.storageKey,
      eventId: file.eventId,
      revision: file.revision,
      resultSummary: parseUploadResultSummary(relatedResults),
      worker: latestJob
        ? {
            jobId: latestJob.jobId,
            status: latestJob.status,
            currentPhase: latestJob.currentPhase,
            currentStep: latestJob.currentStep,
            startedAt: toIsoString(latestJob.startedAt),
            finishedAt: toIsoString(latestJob.finishedAt),
            errorSummary: latestJob.errorSummary,
          }
        : null,
      result: latestResult
        ? {
            outcome: latestResult.outcome,
            status: latestResult.status,
            reasonCodes: toReasonCodes(latestResult.reasonCodes),
            artifactKey: latestResult.artifactKey,
            finalKey: latestResult.finalKey,
          }
        : null,
    }
  })
}

export const createUpload = async (input: {
  userId: string
  file: UploadFileInput
}) => {
  if (!isPdfFileUpload(input.file)) {
    throw new Error(`Only PDF files are supported: ${input.file.name}`)
  }

  const db = getDb()
  const s3 = createS3ServerClient()
  const bucket = getSourceBucketName()
  const region = getAwsRegion()
  const uploadId = randomUUID()
  const sanitizedFileName = sanitizeUploadFileName(input.file.name)
  const storageKey = buildStorageKey(uploadId, sanitizedFileName)
  const mimeType = 'application/pdf'

  await db.insert(intakeFiles).values({
    id: uploadId,
    uploadedByUserId: input.userId,
    originalFileName: input.file.name,
    ...buildCertificateMetadataFields(input.file.name),
    sanitizedFileName,
    mimeType,
    sizeBytes: input.file.size,
    storageBucket: bucket,
    storageKey,
  })

  const url = await getSignedUrl(
    s3 as never,
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      ContentType: mimeType,
    }) as never,
    { expiresIn: PRESIGN_EXPIRY_SECONDS },
  )

  return {
    bucket,
    region,
    expiresIn: PRESIGN_EXPIRY_SECONDS,
    upload: {
      uploadId,
      fileName: input.file.name,
      sizeBytes: input.file.size,
      mimeType,
      storageKey,
      method: 'PUT' as const,
      url,
      headers: {
        'content-type': mimeType,
      },
    },
  }
}

export const getUploadById = async (uploadId: string) => {
  const db = getDb()
  const files = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.id, uploadId))
    .limit(1)
  if (files.length === 0) {
    return null
  }
  const file = files[0]

  const jobs = await db
    .select()
    .from(workerJobs)
    .where(eq(workerJobs.uploadId, uploadId))
    .orderBy(desc(workerJobs.createdAt))

  const results = await db
    .select()
    .from(documentResults)
    .where(eq(documentResults.uploadId, uploadId))
    .orderBy(desc(documentResults.createdAt))

  return mapUploadViews([file], jobs, results)[0] ?? null
}

export const resolveUploadAttention = async (input: {
  uploadId: string
  userId: string
}) => {
  const db = getDb()
  const files = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.id, input.uploadId))
    .limit(1)
  const file = files.at(0)

  if (!file) {
    return null
  }

  if (file.attentionStatus === 'resolved') {
    return getUploadById(file.id)
  }

  const overallStatus = resolveOverallStatus(file)
  if (!['duplicate', 'error'].includes(overallStatus)) {
    throw new Error('Only failed or duplicate uploads can be marked resolved.')
  }

  await db
    .update(intakeFiles)
    .set({
      attentionStatus: 'resolved',
      attentionResolvedAt: new Date(),
      attentionResolvedByUserId: input.userId,
      updatedAt: new Date(),
    })
    .where(eq(intakeFiles.id, file.id))

  return getUploadById(file.id)
}

export const completeUploadAndQueue = async (input: { uploadId: string }) => {
  const db = getDb()
  const s3 = createS3ServerClient()
  const sqs = createSqsServerClient()
  const queueUrl = getQueueUrl()

  const files = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.id, input.uploadId))
    .limit(1)
  if (files.length === 0) {
    throw new Error('Upload record not found.')
  }
  const file = files[0]

  if (
    file.eventId &&
    ['queued', 'processing', 'success', 'duplicate'].includes(
      file.processingStatus === 'pending'
        ? file.queueStatus
        : file.processingStatus,
    )
  ) {
    return getUploadById(file.id)
  }

  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: file.storageBucket,
      Key: file.storageKey,
    }),
  )

  const contentType = head.ContentType?.trim() || file.mimeType
  const contentLength = Number(head.ContentLength ?? 0)
  if (!contentType.toLowerCase().includes('pdf')) {
    throw new Error('Uploaded object is not a PDF.')
  }

  if (contentLength !== file.sizeBytes) {
    throw new Error(
      `Uploaded object size mismatch for ${file.originalFileName}. Expected ${file.sizeBytes}, received ${contentLength}.`,
    )
  }

  const revision =
    head.VersionId?.trim() ||
    head.ETag?.replace(/"/g, '').trim() ||
    randomUUID()
  const eventId = `${file.id}:${revision}`
  const traceId = file.traceId?.trim() || randomUUID()
  const now = new Date()
  const nowIso = now.toISOString()
  const uploadedAt = file.uploadedAt ?? now
  const artifactUri = `s3://${file.storageBucket}/${file.storageKey}`

  await db
    .update(intakeFiles)
    .set({
      uploadStatus: 'uploaded',
      queueStatus: 'sending',
      processingStatus: 'pending',
      sourceFileId: file.id,
      revision,
      eventId,
      traceId,
      artifactUri,
      uploadedAt,
      errorMessage: null,
      updatedAt: now,
    })
    .where(eq(intakeFiles.id, file.id))

  try {
    const payload = QueueMessageSchema.parse({
      event: {
        version: 'v1',
        eventId,
        traceId,
        source: 'manual-upload',
        uploadId: file.id,
        sourceFileId: file.id,
        revision,
        originalFileName: file.originalFileName,
        modifiedTime: nowIso,
        mimeType: contentType,
        sizeBytes: file.sizeBytes,
        artifactUri,
        uploadedByUserId: file.uploadedByUserId,
        uploadedAt: uploadedAt.toISOString(),
        receivedAt: nowIso,
      },
    })

    const response = await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(payload),
      }),
    )

    await db
      .update(intakeFiles)
      .set({
        uploadStatus: 'uploaded',
        queueStatus: 'queued',
        queueMessageId: response.MessageId ?? null,
        queuedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(intakeFiles.id, file.id))

    return getUploadById(file.id)
  } catch (error) {
    await db
      .update(intakeFiles)
      .set({
        queueStatus: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(intakeFiles.id, file.id))

    throw error
  }
}

export const listRecentUploads = async (limit = 10) => {
  const db = getDb()
  const files = await db
    .select()
    .from(intakeFiles)
    .orderBy(desc(intakeFiles.createdAt))
    .limit(limit)

  if (files.length === 0) {
    return {
      uploads: [] satisfies Array<IntakeUploadView>,
      summary: emptyStatusSummary(),
    }
  }

  const uploadIds = files.map((file) => file.id)
  const jobs =
    uploadIds.length > 0
      ? await db
          .select()
          .from(workerJobs)
          .where(inArray(workerJobs.uploadId, uploadIds))
          .orderBy(desc(workerJobs.createdAt))
      : []

  const results =
    uploadIds.length > 0
      ? await db
          .select()
          .from(documentResults)
          .where(inArray(documentResults.uploadId, uploadIds))
          .orderBy(desc(documentResults.createdAt))
      : []

  const uploads = mapUploadViews(files, jobs, results)
  return {
    uploads,
    summary: toStatusSummary(uploads),
  }
}

export { isPdfFileUpload, uploadCreateSchema }
