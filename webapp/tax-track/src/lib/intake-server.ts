import { randomUUID } from 'node:crypto'

import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { QueueMessageSchema } from '@taxtrack/shared'
import { desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

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
  computeCounts,
  deriveBatchStatus,
  isPdfFileUpload,
  resolveOverallStatus,
  type UploadFileInput,
  uploadBatchCreateSchema,
} from '@/lib/intake-utils'
import {
  documentResults,
  intakeBatches,
  intakeFiles,
  workerJobs,
} from '@/lib/schema'

const PRESIGN_EXPIRY_SECONDS = 60 * 15

export const completeUploadSchema = z.object({
  uploadId: z.string().uuid(),
})

type IntakeFileRecord = typeof intakeFiles.$inferSelect
type IntakeBatchRecord = typeof intakeBatches.$inferSelect
type WorkerJobRecord = typeof workerJobs.$inferSelect
type DocumentResultRecord = typeof documentResults.$inferSelect

export type IntakeFileView = {
  id: string
  batchId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadStatus: string
  queueStatus: string
  processingStatus: string
  overallStatus: string
  currentPhase: string | null
  currentStep: string | null
  errorMessage: string | null
  uploadedAt: string | null
  queuedAt: string | null
  processingStartedAt: string | null
  processingFinishedAt: string | null
  storageKey: string
  eventId: string | null
  revision: string | null
  worker: {
    jobId: string
    status: string
    currentPhase: string | null
    currentStep: string | null
    startedAt: string | null
    finishedAt: string | null
    errorSummary: string | null
  } | null
  result: {
    outcome: string
    status: string
    reasonCodes: Array<string>
    artifactKey: string | null
    finalKey: string | null
  } | null
}

export type IntakeBatchView = {
  id: string
  status: string
  totalFiles: number
  createdAt: string
  updatedAt: string
  counts: Record<string, number>
  files: Array<IntakeFileView>
}

const toIsoString = (value: Date | null | undefined) => value?.toISOString() ?? null

const toReasonCodes = (value: unknown): Array<string> => {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

const buildStorageKey = (batchId: string, uploadId: string, fileName: string) =>
  `uploads/${batchId}/${uploadId}/${sanitizeUploadFileName(fileName)}`

export const refreshBatchStatus = async (batchId: string) => {
  const db = getDb()
  const files = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.batchId, batchId))

  const status = deriveBatchStatus(files)
  await db
    .update(intakeBatches)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(intakeBatches.id, batchId))
}

export const createUploadBatch = async (input: {
  userId: string
  files: Array<UploadFileInput>
}) => {
  for (const file of input.files) {
    if (!isPdfFileUpload(file)) {
      throw new Error(`Only PDF files are supported: ${file.name}`)
    }
  }

  const db = getDb()
  const s3 = createS3ServerClient()
  const bucket = getSourceBucketName()
  const region = getAwsRegion()

  const [batch] = await db
    .insert(intakeBatches)
    .values({
      createdByUserId: input.userId,
      status: 'pending',
      totalFiles: input.files.length,
    })
    .returning()

  const preparedUploads = input.files.map((file) => {
    const uploadId = randomUUID()
    const sanitizedFileName = sanitizeUploadFileName(file.name)
    const storageKey = buildStorageKey(batch.id, uploadId, sanitizedFileName)

    return {
      id: uploadId,
      batchId: batch.id,
      uploadedByUserId: input.userId,
      originalFileName: file.name,
      sanitizedFileName,
      mimeType: 'application/pdf',
      sizeBytes: file.size,
      storageBucket: bucket,
      storageKey,
    }
  })

  await db.insert(intakeFiles).values(preparedUploads)

  const uploads = await Promise.all(
    preparedUploads.map(async (file) => {
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({
          Bucket: bucket,
          Key: file.storageKey,
          ContentType: file.mimeType,
        }),
        { expiresIn: PRESIGN_EXPIRY_SECONDS },
      )

      return {
        uploadId: file.id,
        fileName: file.originalFileName,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        storageKey: file.storageKey,
        method: 'PUT' as const,
        url,
        headers: {
          'content-type': file.mimeType,
        },
      }
    }),
  )

  return {
    batchId: batch.id,
    bucket,
    region,
    expiresIn: PRESIGN_EXPIRY_SECONDS,
    uploads,
  }
}

export const completeUploadAndQueue = async (input: {
  uploadId: string
}) => {
  const db = getDb()
  const s3 = createS3ServerClient()
  const sqs = createSqsServerClient()
  const queueUrl = getQueueUrl()

  const [file] = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.id, input.uploadId))
    .limit(1)

  if (!file) {
    throw new Error('Upload record not found.')
  }

  if (
    file.eventId &&
    ['queued', 'processing', 'success', 'duplicate'].includes(
      file.processingStatus === 'pending' ? file.queueStatus : file.processingStatus,
    )
  ) {
    return getBatchById(file.batchId)
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
  const now = new Date().toISOString()
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
      uploadedAt: file.uploadedAt ?? new Date(),
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(intakeFiles.id, file.id))

  try {
    const payload = QueueMessageSchema.parse({
      event: {
        version: 'v1',
        eventId,
        traceId,
        source: 'manual-upload',
        batchId: file.batchId,
        uploadId: file.id,
        sourceFileId: file.id,
        revision,
        originalFileName: file.originalFileName,
        modifiedTime: now,
        mimeType: contentType,
        sizeBytes: file.sizeBytes,
        artifactUri,
        uploadedByUserId: file.uploadedByUserId,
        uploadedAt: (file.uploadedAt ?? new Date()).toISOString(),
        receivedAt: now,
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

    await refreshBatchStatus(file.batchId)

    return getBatchById(file.batchId)
  } catch (error) {
    await db
      .update(intakeFiles)
      .set({
        queueStatus: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(intakeFiles.id, file.id))

    await refreshBatchStatus(file.batchId)
    throw error
  }
}

const mapBatchFiles = (
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
  for (const result of results) {
    if (!latestResultByUpload.has(result.uploadId)) {
      latestResultByUpload.set(result.uploadId, result)
    }
  }

  return files.map<IntakeFileView>((file) => {
    const latestJob = latestJobByUpload.get(file.id) ?? null
    const latestResult = latestResultByUpload.get(file.id) ?? null

    return {
      id: file.id,
      batchId: file.batchId,
      fileName: file.originalFileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadStatus: file.uploadStatus,
      queueStatus: file.queueStatus,
      processingStatus: file.processingStatus,
      overallStatus: resolveOverallStatus(file),
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

const buildBatchView = (
  batch: IntakeBatchRecord,
  files: Array<IntakeFileRecord>,
  jobs: Array<WorkerJobRecord>,
  results: Array<DocumentResultRecord>,
): IntakeBatchView => {
  const fileViews = mapBatchFiles(files, jobs, results).sort((left, right) =>
    right.fileName.localeCompare(left.fileName),
  )

  return {
    id: batch.id,
    status: batch.status,
    totalFiles: batch.totalFiles,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    counts: computeCounts(fileViews),
    files: fileViews,
  }
}

export { deriveBatchStatus, isPdfFileUpload, uploadBatchCreateSchema }

export const listUploadBatches = async (limit = 10) => {
  const db = getDb()
  const batches = await db
    .select()
    .from(intakeBatches)
    .orderBy(desc(intakeBatches.createdAt))
    .limit(limit)

  if (batches.length === 0) {
    return [] satisfies Array<IntakeBatchView>
  }

  const batchIds = batches.map((batch) => batch.id)
  const files = await db
    .select()
    .from(intakeFiles)
    .where(inArray(intakeFiles.batchId, batchIds))
    .orderBy(desc(intakeFiles.createdAt))

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

  return batches.map((batch) =>
    buildBatchView(
      batch,
      files.filter((file) => file.batchId === batch.id),
      jobs.filter((job) => job.batchId === batch.id),
      results.filter((result) => result.batchId === batch.id),
    ),
  )
}

export const getBatchById = async (batchId: string) => {
  const db = getDb()
  const [batch] = await db
    .select()
    .from(intakeBatches)
    .where(eq(intakeBatches.id, batchId))
    .limit(1)

  if (!batch) {
    return null
  }

  const files = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.batchId, batchId))
    .orderBy(desc(intakeFiles.createdAt))

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

  return buildBatchView(batch, files, jobs, results)
}

export const getUploadFileById = async (uploadId: string) => {
  const db = getDb()
  const [file] = await db
    .select()
    .from(intakeFiles)
    .where(eq(intakeFiles.id, uploadId))
    .limit(1)

  return file ?? null
}
