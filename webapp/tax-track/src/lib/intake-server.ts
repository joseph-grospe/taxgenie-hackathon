import { randomUUID } from 'node:crypto'

import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  QueueMessageSchema,
  buildCertificateMetadataFields,
} from '@taxtrack/shared'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import type {
  IntakeBatchView,
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
import {
  certificateSignedArtifacts,
  documentResults,
  entities,
  intakeBatches,
  intakeFiles,
  reconciliationResults,
  workerJobs,
} from '@/lib/schema'

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

export const removeUploadSchema = z.object({
  uploadId: z.string().uuid(),
})

export const closeUploadBatchSchema = z.object({})

export const renameUploadBatchSchema = z.object({
  name: z
    .string()
    .nullable()
    .transform((value) => {
      if (value === null) {
        return null
      }

      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })
    .refine((value) => value === null || value.length <= 80, {
      message: 'Batch name must be 80 characters or fewer.',
    }),
})

export const reopenUploadBatchSchema = z.object({})

type IntakeBatchRecord = typeof intakeBatches.$inferSelect
type IntakeFileRecord = typeof intakeFiles.$inferSelect
type WorkerJobRecord = typeof workerJobs.$inferSelect
type DocumentResultRecord = typeof documentResults.$inferSelect
type SignedArtifactRecord = typeof certificateSignedArtifacts.$inferSelect
type ReconciliationRecord = typeof reconciliationResults.$inferSelect
type EntityRecord = typeof entities.$inferSelect

type BatchEntitySnapshot = {
  shortName: string | null
  companyName: string | null
  tin: string
}

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

const parseUploadResultSummary = (
  results: Array<DocumentResultRecord>,
): IntakeUploadResultSummary | null => {
  const latestResult = results.at(0)
  if (!latestResult) {
    return null
  }

  return {
    detected: latestResult.status === 'success' ? 1 : null,
    validated: latestResult.status === 'success' ? 1 : 0,
    skipped: null,
    needsReview: latestResult.status === 'success' ? 0 : 1,
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

const buildStorageKey = (batchId: string, uploadId: string, fileName: string) =>
  `uploads/${batchId}/${uploadId}/${sanitizeUploadFileName(fileName)}`

const normalizeTinDigits = (value: string | null | undefined) =>
  (value ?? '').replace(/\D/g, '')

const getTinPrefix9 = (value: string | null | undefined) => {
  const normalized = normalizeTinDigits(value)
  return normalized.length >= 9 ? normalized.slice(0, 9) : null
}

const toBatchEntitySnapshot = (
  batch: Pick<
    IntakeBatchRecord,
    'entityShortName' | 'entityCompanyName' | 'entityTin'
  >,
): BatchEntitySnapshot | null => {
  if (!batch.entityTin?.trim()) {
    return null
  }

  return {
    shortName: batch.entityShortName,
    companyName: batch.entityCompanyName,
    tin: batch.entityTin,
  }
}

const toEntitySnapshot = (entity: EntityRecord): BatchEntitySnapshot => {
  const tin = entity.tin?.trim()
  if (!tin || !getTinPrefix9(tin)) {
    throw new Error('Selected entity must have a valid TIN.')
  }

  return {
    shortName: entity.shortName,
    companyName: entity.companyName,
    tin,
  }
}

const resolveEntitySnapshotById = async (entityId: number) => {
  const db = getDb()
  const rows = await db
    .select()
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1)
  const entity = rows.at(0)
  if (!entity) {
    throw new Error('Selected entity was not found.')
  }

  return toEntitySnapshot(entity)
}

const canRemoveUploadFromBatch = (file: IntakeFileRecord) =>
  !file.removedFromBatchAt &&
  ['duplicate', 'error'].includes(resolveOverallStatus(file))

const activeBatchFileWhere = (batchIds: Array<string>) =>
  and(
    inArray(intakeFiles.batchId, batchIds),
    isNull(intakeFiles.removedFromBatchAt),
  )

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
      batchId: file.batchId,
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
      removedFromBatchAt: toIsoString(file.removedFromBatchAt),
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

const deriveBatchOverallStatus = (input: {
  batch: Pick<IntakeBatchRecord, 'status'>
  uploads: Array<IntakeUploadView>
  counts: IntakeStatusSummary
}) => {
  const { batch, uploads, counts } = input
  const hasAttention = uploads.some((upload) => hasOpenAttention(upload))

  if (batch.status === 'open') {
    return 'Active'
  }

  if (hasAttention) {
    return 'Needs Review'
  }

  if (counts.processing > 0 || counts.queued > 0 || counts.uploaded > 0) {
    return 'Processing'
  }

  if (counts.pending > 0) {
    return 'Pending'
  }

  if (counts.success > 0 && counts.duplicate === 0 && counts.error === 0) {
    return 'Completed'
  }

  if (counts.duplicate > 0 || counts.error > 0) {
    return 'Needs Review'
  }

  return 'Completed'
}

const hasActiveBatchWork = (counts: IntakeStatusSummary) =>
  counts.pending > 0 ||
  counts.uploaded > 0 ||
  counts.queued > 0 ||
  counts.processing > 0

export const getBatchSigningState = (input: {
  batch: Pick<IntakeBatchRecord, 'id' | 'status'>
  counts: IntakeStatusSummary
  signingStatusByBatchId: Map<
    string,
    {
      certificateCount: number
      signedCount: number
    }
  >
  reconciliationStatusByBatchId?: Map<
    string,
    {
      reconciledCount: number
    }
  >
}) => {
  const summary = input.signingStatusByBatchId.get(input.batch.id) ?? {
    certificateCount: 0,
    signedCount: 0,
  }
  const reconciliationSummary = input.reconciliationStatusByBatchId?.get(
    input.batch.id,
  ) ?? {
    reconciledCount: 0,
  }
  const canEnterSigning =
    input.batch.status === 'closed' &&
    !hasActiveBatchWork(input.counts) &&
    summary.certificateCount > 0 &&
    reconciliationSummary.reconciledCount === summary.certificateCount

  if (!canEnterSigning) {
    return {
      canSignBatch: false,
      batchSigningStatus: 'unavailable' as const,
    }
  }

  const allSigned = summary.signedCount === summary.certificateCount

  return {
    canSignBatch: !allSigned,
    batchSigningStatus: allSigned
      ? ('signed' as const)
      : summary.signedCount > 0
        ? ('partial' as const)
        : ('unsigned' as const),
  }
}

const getSigningStatusByBatchId = (
  results: Array<DocumentResultRecord>,
  artifacts: Array<SignedArtifactRecord>,
) => {
  const signedResultIds = new Set(
    artifacts
      .filter((artifact) => artifact.status === 'signed')
      .map((artifact) => artifact.documentResultId),
  )
  const summaryByBatchId = new Map<
    string,
    {
      certificateCount: number
      signedCount: number
    }
  >()

  for (const result of results) {
    if (result.status !== 'success') {
      continue
    }

    const current = summaryByBatchId.get(result.batchId) ?? {
      certificateCount: 0,
      signedCount: 0,
    }

    current.certificateCount += 1
    if (signedResultIds.has(result.id)) {
      current.signedCount += 1
    }

    summaryByBatchId.set(result.batchId, current)
  }

  return summaryByBatchId
}

const getReconciliationStatusByBatchId = (
  results: Array<DocumentResultRecord>,
  reconciliationRows: Array<ReconciliationRecord>,
) => {
  const resultBatchById = new Map(
    results
      .filter((result) => result.status === 'success')
      .map((result) => [result.id, result.batchId]),
  )
  const reconciledResultIds = new Set(
    reconciliationRows.flatMap((row) => {
      if (row.matchStatus !== 'matched' || row.matchedTaxRecordId === null) {
        return []
      }

      return resultBatchById.has(row.matchedTaxRecordId)
        ? [row.matchedTaxRecordId]
        : []
    }),
  )
  const summaryByBatchId = new Map<
    string,
    {
      reconciledCount: number
    }
  >()

  for (const resultId of reconciledResultIds) {
    const batchId = resultBatchById.get(resultId)
    if (!batchId) {
      continue
    }

    const current = summaryByBatchId.get(batchId) ?? {
      reconciledCount: 0,
    }
    current.reconciledCount += 1
    summaryByBatchId.set(batchId, current)
  }

  return summaryByBatchId
}

const mapBatchViews = (
  batches: Array<IntakeBatchRecord>,
  uploads: Array<IntakeUploadView>,
  signingStatusByBatchId = new Map<
    string,
    {
      certificateCount: number
      signedCount: number
    }
  >(),
  reconciliationStatusByBatchId = new Map<
    string,
    {
      reconciledCount: number
    }
  >(),
): Array<IntakeBatchView> => {
  const uploadsByBatchId = new Map<string, Array<IntakeUploadView>>()

  for (const upload of uploads) {
    const current = uploadsByBatchId.get(upload.batchId) ?? []
    current.push(upload)
    uploadsByBatchId.set(upload.batchId, current)
  }

  return batches.map<IntakeBatchView>((batch) => {
    const batchUploads = uploadsByBatchId.get(batch.id) ?? []
    const counts = toStatusSummary(batchUploads)
    const totalFiles =
      batch.totalFiles > 0 ? batch.totalFiles : Math.max(batchUploads.length, 0)
    const signingState = getBatchSigningState({
      batch,
      counts,
      signingStatusByBatchId,
      reconciliationStatusByBatchId,
    })

    return {
      id: batch.id,
      name: batch.name,
      entity: toBatchEntitySnapshot(batch),
      createdByUserId: batch.createdByUserId,
      status: batch.status === 'closed' ? 'closed' : 'open',
      overallStatus: deriveBatchOverallStatus({
        batch,
        uploads: batchUploads,
        counts,
      }),
      canSignBatch: signingState.canSignBatch,
      batchSigningStatus: signingState.batchSigningStatus,
      totalFiles,
      openAttentionCount: batchUploads.filter((upload) =>
        hasOpenAttention(upload),
      ).length,
      counts,
      lastActivityAt: toIsoString(batch.lastActivityAt),
      closedAt: toIsoString(batch.closedAt),
      createdAt: toIsoString(batch.createdAt),
      updatedAt: toIsoString(batch.updatedAt),
      files: batchUploads,
    }
  })
}

const getBatchViews = async (batches: Array<IntakeBatchRecord>) => {
  if (batches.length === 0) {
    return []
  }

  const db = getDb()
  const batchIds = batches.map((batch) => batch.id)
  const files = await db
    .select()
    .from(intakeFiles)
    .where(activeBatchFileWhere(batchIds))
    .orderBy(desc(intakeFiles.createdAt))

  if (files.length === 0) {
    return mapBatchViews(batches, [])
  }

  const uploadIds = files.map((file) => file.id)
  const jobs = await db
    .select()
    .from(workerJobs)
    .where(inArray(workerJobs.uploadId, uploadIds))
    .orderBy(desc(workerJobs.createdAt))

  const results = await db
    .select()
    .from(documentResults)
    .where(inArray(documentResults.uploadId, uploadIds))
    .orderBy(desc(documentResults.createdAt))

  const certificateResultIds = results
    .filter((result) => result.status === 'success')
    .map((result) => result.id)
  const signedArtifacts =
    certificateResultIds.length === 0
      ? []
      : await db
          .select()
          .from(certificateSignedArtifacts)
          .where(
            inArray(
              certificateSignedArtifacts.documentResultId,
              certificateResultIds,
            ),
          )

  const reconciliationRows =
    certificateResultIds.length === 0
      ? []
      : await db
          .select()
          .from(reconciliationResults)
          .where(
            inArray(
              reconciliationResults.matchedTaxRecordId,
              certificateResultIds,
            ),
          )

  return mapBatchViews(
    batches,
    mapUploadViews(files, jobs, results),
    getSigningStatusByBatchId(results, signedArtifacts),
    getReconciliationStatusByBatchId(results, reconciliationRows),
  )
}

const getBatchViewById = async (batchId: string) => {
  const db = getDb()
  const batches = await db
    .select()
    .from(intakeBatches)
    .where(eq(intakeBatches.id, batchId))
    .limit(1)

  return (await getBatchViews(batches)).at(0) ?? null
}

const getBatchRecordById = async (batchId: string) => {
  const db = getDb()
  const batches = await db
    .select()
    .from(intakeBatches)
    .where(eq(intakeBatches.id, batchId))
    .limit(1)

  return batches.at(0) ?? null
}

const lockOpenBatch = async (
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  userId: string,
) => {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`intake-batch:${userId}`}))`,
  )
}

const reconcileOpenBatchRecords = async (input: {
  userId: string
  createIfMissing?: boolean
  preferredBatchId?: string
}) => {
  const db = getDb()

  return db.transaction(async (tx) => {
    await lockOpenBatch(tx, input.userId)

    const openBatches = await tx
      .select()
      .from(intakeBatches)
      .where(
        and(
          eq(intakeBatches.createdByUserId, input.userId),
          eq(intakeBatches.status, 'open'),
        ),
      )
      .orderBy(desc(intakeBatches.updatedAt), desc(intakeBatches.createdAt))

    const preferredBatch = openBatches.find(
      (batch) => batch.id === input.preferredBatchId,
    )
    let canonicalBatch = preferredBatch ?? openBatches.at(0)

    if (!canonicalBatch && !input.createIfMissing) {
      return null
    }

    const now = new Date()

    if (!canonicalBatch) {
      const created = await tx
        .insert(intakeBatches)
        .values({
          createdByUserId: input.userId,
          status: 'open',
          totalFiles: 0,
          lastActivityAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      const createdBatch = created.at(0)
      if (!createdBatch) {
        throw new Error('Unable to create an upload batch.')
      }

      canonicalBatch = createdBatch
    }

    const duplicateBatchIds = openBatches
      .filter((batch) => batch.id !== canonicalBatch.id)
      .map((batch) => batch.id)

    if (duplicateBatchIds.length > 0) {
      await tx
        .update(intakeFiles)
        .set({ batchId: canonicalBatch.id })
        .where(inArray(intakeFiles.batchId, duplicateBatchIds))

      await tx
        .update(workerJobs)
        .set({ batchId: canonicalBatch.id })
        .where(inArray(workerJobs.batchId, duplicateBatchIds))

      await tx
        .update(documentResults)
        .set({ batchId: canonicalBatch.id })
        .where(inArray(documentResults.batchId, duplicateBatchIds))

      await tx
        .delete(intakeBatches)
        .where(inArray(intakeBatches.id, duplicateBatchIds))
    }

    const [{ totalFiles }] = await tx
      .select({
        totalFiles: sql<number>`count(*)::int`,
      })
      .from(intakeFiles)
      .where(
        and(
          eq(intakeFiles.batchId, canonicalBatch.id),
          isNull(intakeFiles.removedFromBatchAt),
        ),
      )

    const lastActivityAt = new Date(
      Math.max(
        canonicalBatch.lastActivityAt.getTime(),
        ...openBatches
          .filter((batch) => batch.id !== canonicalBatch.id)
          .map((batch) => batch.lastActivityAt.getTime()),
        now.getTime(),
      ),
    )

    const updated = await tx
      .update(intakeBatches)
      .set({
        totalFiles,
        lastActivityAt,
        updatedAt: now,
      })
      .where(eq(intakeBatches.id, canonicalBatch.id))
      .returning()

    return updated[0] ?? canonicalBatch
  })
}

const getOpenBatchRecord = async (userId: string) => {
  return reconcileOpenBatchRecords({
    userId,
    createIfMissing: false,
  })
}

const touchBatch = async (batchId: string, now = new Date()) => {
  const db = getDb()
  await db
    .update(intakeBatches)
    .set({
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(eq(intakeBatches.id, batchId))
}

export const createUpload = async (input: {
  userId: string
  batchId?: string
  entityId?: number
  files: Array<UploadFileInput>
}) => {
  if (input.files.length === 0) {
    throw new Error('At least one file is required.')
  }

  for (const file of input.files) {
    if (!isPdfFileUpload(file)) {
      throw new Error(`Only PDF files are supported: ${file.name}`)
    }
  }

  const db = getDb()
  const s3 = createS3ServerClient()
  const bucket = getSourceBucketName()
  const region = getAwsRegion()
  const now = new Date()
  const selectedEntity = input.entityId
    ? await resolveEntitySnapshotById(input.entityId)
    : null

  let targetBatch = input.batchId
    ? ((
        await db
          .select()
          .from(intakeBatches)
          .where(eq(intakeBatches.id, input.batchId))
          .limit(1)
      ).at(0) ?? null)
    : null

  if (input.batchId && !targetBatch) {
    throw new Error('The selected upload batch no longer exists.')
  }

  if (targetBatch) {
    if (targetBatch.createdByUserId !== input.userId) {
      throw new Error('You can only add files to your own open batch.')
    }

    if (targetBatch.status !== 'open') {
      throw new Error('The selected upload batch is already closed.')
    }
  }

  targetBatch = await reconcileOpenBatchRecords({
    userId: input.userId,
    createIfMissing: true,
    preferredBatchId: targetBatch?.id,
  })

  if (!targetBatch) {
    throw new Error('Unable to create an upload batch.')
  }

  let batchEntity = toBatchEntitySnapshot(targetBatch)
  const totalFiles = Number(targetBatch.totalFiles ?? 0)

  if (batchEntity) {
    if (selectedEntity) {
      const batchTinPrefix = getTinPrefix9(batchEntity.tin)
      const selectedTinPrefix = getTinPrefix9(selectedEntity.tin)

      if (!batchTinPrefix || !selectedTinPrefix) {
        throw new Error('The open upload batch has an invalid entity TIN.')
      }

      if (batchTinPrefix !== selectedTinPrefix) {
        throw new Error(
          'The selected entity does not match the open upload batch entity.',
        )
      }
    }
  } else {
    if (totalFiles > 0) {
      throw new Error(
        'Close this legacy upload batch before starting entity-based uploads.',
      )
    }

    if (!selectedEntity) {
      throw new Error('Choose an entity before uploading documents.')
    }

    batchEntity = selectedEntity

    const updated = await db
      .update(intakeBatches)
      .set({
        entityShortName: selectedEntity.shortName,
        entityCompanyName: selectedEntity.companyName,
        entityTin: selectedEntity.tin,
        updatedAt: now,
      })
      .where(eq(intakeBatches.id, targetBatch.id))
      .returning()

    targetBatch = updated.at(0) ?? {
      ...targetBatch,
      entityShortName: selectedEntity.shortName,
      entityCompanyName: selectedEntity.companyName,
      entityTin: selectedEntity.tin,
    }
  }

  const uploads = input.files.map((file) => {
    const uploadId = randomUUID()
    const sanitizedFileName = sanitizeUploadFileName(file.name)

    return {
      uploadId,
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: 'application/pdf',
      storageKey: buildStorageKey(targetBatch.id, uploadId, sanitizedFileName),
      headers: {
        'content-type': 'application/pdf',
      },
      dbValue: {
        id: uploadId,
        batchId: targetBatch.id,
        uploadedByUserId: input.userId,
        originalFileName: file.name,
        ...buildCertificateMetadataFields(file.name),
        sanitizedFileName,
        mimeType: 'application/pdf',
        sizeBytes: file.size,
        storageBucket: bucket,
        storageKey: buildStorageKey(
          targetBatch.id,
          uploadId,
          sanitizedFileName,
        ),
      },
    }
  })

  await db.insert(intakeFiles).values(uploads.map((upload) => upload.dbValue))

  await db
    .update(intakeBatches)
    .set({
      totalFiles: sql`${intakeBatches.totalFiles} + ${input.files.length}`,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(eq(intakeBatches.id, targetBatch.id))

  const presignedUploads = await Promise.all(
    uploads.map(async (upload) => {
      const url = await getSignedUrl(
        s3 as never,
        new PutObjectCommand({
          Bucket: bucket,
          Key: upload.storageKey,
          ContentType: upload.mimeType,
        }) as never,
        { expiresIn: PRESIGN_EXPIRY_SECONDS },
      )

      return {
        batchId: targetBatch.id,
        uploadId: upload.uploadId,
        fileName: upload.fileName,
        sizeBytes: upload.sizeBytes,
        mimeType: upload.mimeType,
        storageKey: upload.storageKey,
        method: 'PUT' as const,
        url,
        headers: upload.headers,
      }
    }),
  )

  const batchView = await getBatchViewById(targetBatch.id)
  if (!batchView) {
    throw new Error('Unable to load the upload batch after creation.')
  }

  return {
    bucket,
    region,
    expiresIn: PRESIGN_EXPIRY_SECONDS,
    batch: batchView,
    uploads: presignedUploads,
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

  return mapUploadViews([file], jobs, results).at(0) ?? null
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

  const now = new Date()

  await db
    .update(intakeFiles)
    .set({
      attentionStatus: 'resolved',
      attentionResolvedAt: now,
      attentionResolvedByUserId: input.userId,
      updatedAt: now,
    })
    .where(eq(intakeFiles.id, file.id))

  await touchBatch(file.batchId, now)

  return getUploadById(file.id)
}

export const removeUploadFromBatch = async (input: {
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

  const batches = await db
    .select()
    .from(intakeBatches)
    .where(eq(intakeBatches.id, file.batchId))
    .limit(1)
  const batch = batches.at(0)

  if (!batch || batch.createdByUserId !== input.userId) {
    throw new Error('You can only remove files from your own upload batch.')
  }

  if (file.removedFromBatchAt) {
    throw new Error('This upload has already been removed from the batch.')
  }

  if (!canRemoveUploadFromBatch(file)) {
    throw new Error(
      'Only duplicate or failed uploads can be removed from the batch.',
    )
  }

  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .update(intakeFiles)
      .set({
        removedFromBatchAt: now,
        removedFromBatchByUserId: input.userId,
        attentionStatus: 'resolved',
        attentionResolvedAt: now,
        attentionResolvedByUserId: input.userId,
        updatedAt: now,
      })
      .where(eq(intakeFiles.id, file.id))

    const [{ remainingFiles }] = await tx
      .select({
        remainingFiles: sql<number>`count(*)::int`,
      })
      .from(intakeFiles)
      .where(
        and(
          eq(intakeFiles.batchId, batch.id),
          isNull(intakeFiles.removedFromBatchAt),
        ),
      )

    await tx
      .update(intakeBatches)
      .set({
        totalFiles: remainingFiles,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(intakeBatches.id, batch.id))
  })

  return {
    removedUploadId: file.id,
    removedBatchId: batch.id,
    batchDeleted: false,
  }
}

export const getUploadBatchById = async (input: {
  batchId: string
  userId: string
}) => {
  const batchRecord = await getBatchRecordById(input.batchId)

  if (!batchRecord) {
    return {
      status: 'not_found' as const,
      batch: null,
    }
  }

  if (batchRecord.createdByUserId !== input.userId) {
    return {
      status: 'forbidden' as const,
      batch: null,
    }
  }

  return {
    status: 'ok' as const,
    batch: await getBatchViewById(batchRecord.id),
  }
}

export const renameUploadBatch = async (input: {
  batchId: string
  userId: string
  name: string | null
}) => {
  const batchRecord = await getBatchRecordById(input.batchId)

  if (!batchRecord) {
    return {
      status: 'not_found' as const,
      batch: null,
    }
  }

  if (batchRecord.createdByUserId !== input.userId) {
    return {
      status: 'forbidden' as const,
      batch: null,
    }
  }

  const db = getDb()
  await db
    .update(intakeBatches)
    .set({
      name: input.name,
      updatedAt: new Date(),
    })
    .where(eq(intakeBatches.id, batchRecord.id))

  return {
    status: 'ok' as const,
    batch: await getBatchViewById(batchRecord.id),
  }
}

export const reopenUploadBatch = async (input: {
  batchId: string
  userId: string
}) => {
  const db = getDb()

  const result = await db.transaction(async (tx) => {
    await lockOpenBatch(tx, input.userId)

    const batchRecords = await tx
      .select()
      .from(intakeBatches)
      .where(eq(intakeBatches.id, input.batchId))
      .limit(1)
    const batchRecord = batchRecords.at(0)

    if (!batchRecord) {
      return {
        status: 'not_found' as const,
        batchId: null,
      }
    }

    if (batchRecord.createdByUserId !== input.userId) {
      return {
        status: 'forbidden' as const,
        batchId: null,
      }
    }

    if (batchRecord.status === 'open') {
      return {
        status: 'ok' as const,
        batchId: batchRecord.id,
      }
    }

    const openBatches = await tx
      .select({ id: intakeBatches.id })
      .from(intakeBatches)
      .where(
        and(
          eq(intakeBatches.createdByUserId, input.userId),
          eq(intakeBatches.status, 'open'),
        ),
      )
      .limit(1)

    if (openBatches.some((batch) => batch.id !== batchRecord.id)) {
      throw new Error(
        'Close your current open upload batch before re-opening this batch.',
      )
    }

    const now = new Date()

    await tx
      .update(intakeBatches)
      .set({
        status: 'open',
        closedAt: null,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(intakeBatches.id, batchRecord.id))

    return {
      status: 'ok' as const,
      batchId: batchRecord.id,
    }
  })

  if (result.status !== 'ok') {
    return {
      status: result.status,
      batch: null,
    }
  }

  return {
    status: 'ok' as const,
    batch: await getBatchViewById(result.batchId),
  }
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
  const batch = await getBatchRecordById(file.batchId)
  if (!batch) {
    throw new Error('Upload batch not found.')
  }
  const selectedEntity = toBatchEntitySnapshot(batch)
  if (!selectedEntity) {
    throw new Error('Choose an entity before queueing uploaded documents.')
  }

  if (!getTinPrefix9(selectedEntity.tin)) {
    throw new Error('The selected upload entity has an invalid TIN.')
  }

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

  await touchBatch(file.batchId, now)

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
        modifiedTime: nowIso,
        mimeType: contentType,
        sizeBytes: file.sizeBytes,
        artifactUri,
        selectedEntity,
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

    const queuedAt = new Date()

    await db
      .update(intakeFiles)
      .set({
        uploadStatus: 'uploaded',
        queueStatus: 'queued',
        queueMessageId: response.MessageId ?? null,
        queuedAt,
        errorMessage: null,
        updatedAt: queuedAt,
      })
      .where(eq(intakeFiles.id, file.id))

    await touchBatch(file.batchId, queuedAt)

    return getUploadById(file.id)
  } catch (error) {
    const failedAt = new Date()

    await db
      .update(intakeFiles)
      .set({
        queueStatus: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: failedAt,
      })
      .where(eq(intakeFiles.id, file.id))

    await touchBatch(file.batchId, failedAt)

    throw error
  }
}

export const closeActiveUploadBatch = async (input: { userId: string }) => {
  const batch = await getOpenBatchRecord(input.userId)
  if (!batch) {
    return null
  }

  const db = getDb()
  const now = new Date()

  await db
    .update(intakeBatches)
    .set({
      status: 'closed',
      closedAt: now,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(eq(intakeBatches.id, batch.id))

  return getBatchViewById(batch.id)
}

export const listRecentUploads = async (userId: string, limit = 10) => {
  const db = getDb()
  const activeBatchRecord = await getOpenBatchRecord(userId)

  const recentBatchRecords = await db
    .select()
    .from(intakeBatches)
    .where(eq(intakeBatches.createdByUserId, userId))
    .orderBy(desc(intakeBatches.lastActivityAt), desc(intakeBatches.createdAt))
    .limit(limit + (activeBatchRecord ? 1 : 0))

  const filteredRecentRecords = activeBatchRecord
    ? recentBatchRecords.filter((batch) => batch.id !== activeBatchRecord.id)
    : recentBatchRecords

  const [activeBatch, recentBatches] = await Promise.all([
    activeBatchRecord
      ? getBatchViews([activeBatchRecord])
      : Promise.resolve([]),
    getBatchViews(filteredRecentRecords.slice(0, limit)),
  ])

  const allUploads = [...activeBatch, ...recentBatches].flatMap(
    (batch) => batch.files,
  )

  return {
    activeBatch: activeBatch.at(0) ?? null,
    recentBatches,
    summary: toStatusSummary(allUploads),
  }
}

export { isPdfFileUpload, uploadCreateSchema }
