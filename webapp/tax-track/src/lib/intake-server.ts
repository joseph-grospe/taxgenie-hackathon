import { randomUUID } from 'node:crypto'

import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  QueueMessageSchema,
  buildCertificateMetadataFields,
  buildEntityStorageKey,
  buildRawUploadKey,
} from '@taxtrack/shared'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { SQL } from 'drizzle-orm'

import type {
  BatchFileStatusFilter,
  BatchFilesResponse,
  BatchListResponse,
  BatchListRow,
  IntakeBatchView,
  IntakeUploadResultSummary,
  IntakeUploadView,
} from '@/lib/upload-intake-types'
import type { BuildBatchListOptions } from '@/lib/batch-list'
import type { BatchFilesSearch } from '@/lib/batch-file-search-state'
import type { UploadFileInput } from '@/lib/intake-utils'
import { ACTIVE_BATCH_PREVIEW_PAGE_SIZE } from '@/lib/upload-intake-constants'
import {
  createS3ServerClient,
  createSqsServerClient,
  getAwsRegion,
  getQueueUrl,
  getStorageBucketName,
  getStoragePrefix,
  sanitizeUploadFileName,
} from '@/lib/aws-server'
import {
  logBatchStageTimingError,
  recordBatchStageTiming,
} from '@/lib/batch-stage-timing-server'
import { getDb } from '@/lib/db'
import { resolveEntityScopeFilterById } from '@/lib/entities-server'
import {
  MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES,
  MAX_INTAKE_UPLOAD_FILE_SIZE_LABEL,
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
const BATCH_DELETE_RETENTION_DAYS = 30
const MAX_UPLOAD_BATCH_NAME_LENGTH = 80
const DEFAULT_BATCH_NAME_SEPARATOR = ' - '

const DEFAULT_BATCH_NAME_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
})

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
  uploadStartedAt: z.string().datetime({ offset: true }).optional(),
  uploadFinishedAt: z.string().datetime({ offset: true }).optional(),
})

export const resolveUploadAttentionSchema = z.object({
  uploadId: z.string().uuid(),
})

export const removeUploadSchema = z.object({
  uploadId: z.string().uuid(),
})

export const closeUploadBatchSchema = z.object({
  batchId: z.string().optional(),
})

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
    .refine(
      (value) => value === null || value.length <= MAX_UPLOAD_BATCH_NAME_LENGTH,
      {
        message: 'Batch name must be 80 characters or fewer.',
      },
    ),
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
  id: number
  shortName: string | null
  companyName: string | null
  tin: string
}

type BatchUploadStatusView = {
  batchId: string
  overallStatus: string
  attentionStatus?: 'open' | 'resolved'
}

const isBatchDeleted = (
  batch: Pick<IntakeBatchRecord, 'deletedAt'> | null | undefined,
) => Boolean(batch?.deletedAt)

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000)

const getDefaultBatchEntityName = (
  entity: Pick<
    BatchEntitySnapshot,
    'id' | 'shortName' | 'companyName' | 'tin'
  >,
) =>
  entity.shortName?.trim() ||
  entity.companyName?.trim() ||
  entity.tin.trim() ||
  `Entity ${entity.id}`

export const buildDefaultUploadBatchName = (input: {
  entity: Pick<BatchEntitySnapshot, 'id' | 'shortName' | 'companyName' | 'tin'>
  createdAt: Date
}) => {
  const formattedDate = DEFAULT_BATCH_NAME_DATE_FORMATTER.format(
    input.createdAt,
  )
  const suffix = `${DEFAULT_BATCH_NAME_SEPARATOR}${formattedDate}`
  const maxEntityNameLength = Math.max(
    1,
    MAX_UPLOAD_BATCH_NAME_LENGTH - suffix.length,
  )
  const entityName = getDefaultBatchEntityName(input.entity)
  const trimmedEntityName = entityName.slice(0, maxEntityNameLength).trimEnd()

  return `${trimmedEntityName || entityName.slice(0, maxEntityNameLength)}${suffix}`
}

export type IntakeStatusKey = (typeof statusKeys)[number]

export type IntakeStatusSummary = Record<IntakeStatusKey, number>

const toIsoString = (value: Date | null | undefined) =>
  value?.toISOString() ?? null

const toSqlNumber = (value: unknown) => {
  const number = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

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

const sumStatusSummaries = (
  batches: Array<Pick<IntakeBatchView, 'counts'>>,
): IntakeStatusSummary => {
  const summary = emptyStatusSummary()

  for (const batch of batches) {
    for (const key of statusKeys) {
      summary[key] += batch.counts[key]
    }
  }

  return summary
}

const normalizeTinDigits = (value: string | null | undefined) =>
  (value ?? '').replace(/\D/g, '')

const getTinPrefix9 = (value: string | null | undefined) => {
  const normalized = normalizeTinDigits(value)
  return normalized.length >= 9 ? normalized.slice(0, 9) : null
}

const toBatchEntitySnapshot = (
  batch: Pick<
    IntakeBatchRecord,
    'entityId' | 'entityShortName' | 'entityCompanyName' | 'entityTin'
  >,
): BatchEntitySnapshot | null => {
  if (!batch.entityId || !batch.entityTin?.trim()) {
    return null
  }

  return {
    id: batch.entityId,
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
    id: entity.id,
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
  uploads: Array<BatchUploadStatusView>
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
      filesMode: 'full',
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
      deletedAt: toIsoString(batch.deletedAt),
      deletedByUserId: batch.deletedByUserId,
      purgeAfterAt: toIsoString(batch.purgeAfterAt),
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
            and(
              inArray(
                reconciliationResults.matchedTaxRecordId,
                certificateResultIds,
              ),
              isNull(reconciliationResults.archivedAt),
            ),
          )

  return mapBatchViews(
    batches,
    mapUploadViews(files, jobs, results),
    getSigningStatusByBatchId(results, signedArtifacts),
    getReconciliationStatusByBatchId(results, reconciliationRows),
  )
}

type BatchSummarySqlRow = {
  activeFileCount: number
  pendingCount: number
  uploadedCount: number
  queuedCount: number
  processingCount: number
  successCount: number
  duplicateCount: number
  errorCount: number
  openAttentionCount: number
  certificateCount: number
  signedCount: number
  reconciledCount: number
}

const batchSummarySql = (batchId: string) => sql<BatchSummarySqlRow>`
  with active_files as (
    select
      "id",
      coalesce("attention_status", 'open') as "attention_status",
      case
        when "processing_status" = 'success' then 'success'
        when "processing_status" = 'duplicate' then 'duplicate'
        when "processing_status" = 'error' then 'error'
        when "processing_status" = 'processing' then 'processing'
        when "queue_status" = 'failed' then 'error'
        when "queue_status" in ('queued', 'sending') then 'queued'
        when "upload_status" = 'uploaded' then 'uploaded'
        else 'pending'
      end as "overall_status"
    from "intake_files"
    where "batch_id" = ${batchId}
      and "removed_from_batch_at" is null
  ),
  file_rollups as (
    select
      count(*)::int as "activeFileCount",
      count(*) filter (where "overall_status" = 'pending')::int as "pendingCount",
      count(*) filter (where "overall_status" = 'uploaded')::int as "uploadedCount",
      count(*) filter (where "overall_status" = 'queued')::int as "queuedCount",
      count(*) filter (where "overall_status" = 'processing')::int as "processingCount",
      count(*) filter (where "overall_status" = 'success')::int as "successCount",
      count(*) filter (
        where "overall_status" = 'duplicate'
          and "attention_status" <> 'resolved'
      )::int as "duplicateCount",
      count(*) filter (
        where "overall_status" = 'error'
          and "attention_status" <> 'resolved'
      )::int as "errorCount",
      count(*) filter (
        where "overall_status" in ('duplicate', 'error')
          and "attention_status" <> 'resolved'
      )::int as "openAttentionCount"
    from active_files
  ),
  successful_results as (
    select dr."id"
    from "document_results" dr
    inner join active_files af
      on af."id" = dr."upload_id"
    where dr."status" = 'success'
  ),
  signing_rollups as (
    select
      count(sr."id")::int as "certificateCount",
      count(distinct sa."document_result_id") filter (
        where sa."status" = 'signed'
      )::int as "signedCount"
    from successful_results sr
    left join "certificate_signed_artifacts" sa
      on sa."document_result_id" = sr."id"
     and sa."status" = 'signed'
  ),
  reconciliation_rollups as (
    select
      count(distinct rr."matched_tax_record_id")::int as "reconciledCount"
    from successful_results sr
    inner join "reconciliation_results" rr
      on rr."matched_tax_record_id" = sr."id"
     and rr."match_status" = 'matched'
     and rr."archived_at" is null
  )
  select
    fr."activeFileCount",
    fr."pendingCount",
    fr."uploadedCount",
    fr."queuedCount",
    fr."processingCount",
    fr."successCount",
    fr."duplicateCount",
    fr."errorCount",
    fr."openAttentionCount",
    sr."certificateCount",
    sr."signedCount",
    rr."reconciledCount"
  from file_rollups fr
  cross join signing_rollups sr
  cross join reconciliation_rollups rr
`

const deriveBatchOverallStatusFromCounts = (
  batch: Pick<IntakeBatchRecord, 'status'>,
  counts: IntakeStatusSummary,
  openAttentionCount: number,
) => {
  if (batch.status === 'open') {
    return 'Active'
  }

  if (openAttentionCount > 0) {
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

const getBatchSummaryView = async (batch: IntakeBatchRecord) => {
  const db = getDb()
  const summary = (
    await db.execute<BatchSummarySqlRow>(batchSummarySql(batch.id))
  ).rows.at(0)
  const counts = {
    pending: toSqlNumber(summary?.pendingCount),
    uploaded: toSqlNumber(summary?.uploadedCount),
    queued: toSqlNumber(summary?.queuedCount),
    processing: toSqlNumber(summary?.processingCount),
    success: toSqlNumber(summary?.successCount),
    duplicate: toSqlNumber(summary?.duplicateCount),
    error: toSqlNumber(summary?.errorCount),
  }
  const openAttentionCount = toSqlNumber(summary?.openAttentionCount)
  const signingState = getBatchSigningState({
    batch,
    counts,
    signingStatusByBatchId: new Map([
      [
        batch.id,
        {
          certificateCount: toSqlNumber(summary?.certificateCount),
          signedCount: toSqlNumber(summary?.signedCount),
        },
      ],
    ]),
    reconciliationStatusByBatchId: new Map([
      [
        batch.id,
        {
          reconciledCount: toSqlNumber(summary?.reconciledCount),
        },
      ],
    ]),
  })

  return {
    id: batch.id,
    name: batch.name,
    filesMode: 'summary',
    entity: toBatchEntitySnapshot(batch),
    createdByUserId: batch.createdByUserId,
    status: batch.status === 'closed' ? ('closed' as const) : ('open' as const),
    overallStatus: deriveBatchOverallStatusFromCounts(
      batch,
      counts,
      openAttentionCount,
    ),
    canSignBatch: signingState.canSignBatch,
    batchSigningStatus: signingState.batchSigningStatus,
    totalFiles:
      batch.totalFiles > 0
        ? batch.totalFiles
        : toSqlNumber(summary?.activeFileCount),
    openAttentionCount,
    counts,
    lastActivityAt: toIsoString(batch.lastActivityAt),
    closedAt: toIsoString(batch.closedAt),
    deletedAt: toIsoString(batch.deletedAt),
    deletedByUserId: batch.deletedByUserId,
    purgeAfterAt: toIsoString(batch.purgeAfterAt),
    createdAt: toIsoString(batch.createdAt),
    updatedAt: toIsoString(batch.updatedAt),
    files: [],
  } satisfies IntakeBatchView
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

const getBatchSummaryViewById = async (batchId: string) => {
  const batchRecord = await getBatchRecordById(batchId)
  return batchRecord ? getBatchSummaryView(batchRecord) : null
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
          isNull(intakeBatches.deletedAt),
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
          deletedAt: null,
          deletedByUserId: null,
          purgeAfterAt: null,
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
    .where(and(eq(intakeBatches.id, batchId), isNull(intakeBatches.deletedAt)))
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
  const bucket = getStorageBucketName()
  const prefix = getStoragePrefix()
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

    if (isBatchDeleted(targetBatch)) {
      throw new Error('The selected upload batch has been deleted.')
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
  const totalFiles = Number(targetBatch.totalFiles)

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
    const batchName = targetBatch.name?.trim()
      ? targetBatch.name
      : buildDefaultUploadBatchName({
          entity: selectedEntity,
          createdAt: targetBatch.createdAt,
        })

    const updated = await db
      .update(intakeBatches)
      .set({
        name: batchName,
        entityShortName: selectedEntity.shortName,
        entityCompanyName: selectedEntity.companyName,
        entityTin: selectedEntity.tin,
        entityId: selectedEntity.id,
        updatedAt: now,
      })
      .where(eq(intakeBatches.id, targetBatch.id))
      .returning()

    targetBatch = updated.at(0) ?? {
      ...targetBatch,
      entityShortName: selectedEntity.shortName,
      entityCompanyName: selectedEntity.companyName,
      entityTin: selectedEntity.tin,
      entityId: selectedEntity.id,
      name: batchName,
    }
  }

  const entityKey = buildEntityStorageKey(batchEntity)
  const uploads = input.files.map((file) => {
    const uploadId = randomUUID()
    const sanitizedFileName = sanitizeUploadFileName(file.name)
    const storageKey = buildRawUploadKey({
      prefix,
      entityKey,
      uploadedAt: now,
      batchId: targetBatch.id,
      uploadId,
    })

    return {
      uploadId,
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: 'application/pdf',
      storageKey,
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
        storageKey,
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

  const batchView = await getBatchSummaryViewById(targetBatch.id)
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

  if (
    !batch ||
    isBatchDeleted(batch) ||
    batch.createdByUserId !== input.userId
  ) {
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
  userId?: string
  includeFiles?: boolean
}) => {
  const batchRecord = await getBatchRecordById(input.batchId)

  if (!batchRecord) {
    return {
      status: 'not_found' as const,
      batch: null,
    }
  }

  if (isBatchDeleted(batchRecord)) {
    return {
      status: 'not_found' as const,
      batch: null,
    }
  }

  if (input.userId && batchRecord.createdByUserId !== input.userId) {
    return {
      status: 'forbidden' as const,
      batch: null,
    }
  }

  return {
    status: 'ok' as const,
    batch:
      input.includeFiles === true
        ? await getBatchViewById(batchRecord.id)
        : await getBatchSummaryView(batchRecord),
  }
}

const batchListSigningStatusOrder: Array<
  IntakeBatchView['batchSigningStatus']
> = ['unavailable', 'unsigned', 'partial', 'signed']

type BatchListSqlRow = {
  id: string
  name: string | null
  entityId: number | null
  entityShortName: string | null
  entityCompanyName: string | null
  entityTin: string | null
  entityName: string
  createdByUserId: string
  ownerName: string | null
  ownerEmail: string | null
  status: IntakeBatchView['status']
  overallStatus: string
  canSignBatch: boolean
  batchSigningStatus: IntakeBatchView['batchSigningStatus']
  totalFiles: number
  openAttentionCount: number
  pendingCount: number
  uploadedCount: number
  queuedCount: number
  processingCount: number
  successCount: number
  duplicateCount: number
  errorCount: number
  lastActivityAt: Date | string | null
  closedAt: Date | string | null
  deletedAt: Date | string | null
  deletedByUserId: string | null
  purgeAfterAt: Date | string | null
  createdAt: Date | string | null
  updatedAt: Date | string | null
}

type BatchListMetadataSqlRow = {
  total: number
  active: number
  needsReview: number
  completed: number
  totalItems: number
  statuses: Array<string> | null
  hasUnavailable: boolean
  hasUnsigned: boolean
  hasPartial: boolean
  hasSigned: boolean
}

type BatchListCombinedSqlRow = BatchListMetadataSqlRow & {
  pageRows: unknown
}

const normalizeBatchListText = (value: string | null | undefined) =>
  (value ?? '').trim().toLowerCase()

const escapeLikePattern = (value: string) => value.replaceAll(/[%_\\]/g, '\\$&')

const toBatchListNumber = (value: unknown) => {
  const number = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

const toBatchListIsoString = (value: Date | string | null | undefined) => {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}

const buildBatchListProjectionSql = (
  repository: BuildBatchListOptions['repository'],
) => {
  const candidatePredicate =
    repository === 'deleted'
      ? sql`b."deleted_at" is not null`
      : sql`b."deleted_at" is null`

  return sql`
  candidate_batches as (
    select b.*
    from "intake_batches" b
    where ${candidatePredicate}
  ),
  file_statuses as (
    select
      f."batch_id",
      coalesce(f."attention_status", 'open') as "attention_status",
      case
        when f."processing_status" = 'success' then 'success'
        when f."processing_status" = 'duplicate' then 'duplicate'
        when f."processing_status" = 'error' then 'error'
        when f."processing_status" = 'processing' then 'processing'
        when f."queue_status" = 'failed' then 'error'
        when f."queue_status" in ('queued', 'sending') then 'queued'
        when f."upload_status" = 'uploaded' then 'uploaded'
        else 'pending'
      end as "overall_status"
    from "intake_files" f
    inner join candidate_batches cb
      on cb."id" = f."batch_id"
    where f."removed_from_batch_at" is null
  ),
  file_rollups as (
    select
      "batch_id",
      count(*)::int as "active_file_count",
      count(*) filter (where "overall_status" = 'pending')::int as "pending_count",
      count(*) filter (where "overall_status" = 'uploaded')::int as "uploaded_count",
      count(*) filter (where "overall_status" = 'queued')::int as "queued_count",
      count(*) filter (where "overall_status" = 'processing')::int as "processing_count",
      count(*) filter (where "overall_status" = 'success')::int as "success_count",
      count(*) filter (
        where "overall_status" = 'duplicate'
          and "attention_status" <> 'resolved'
      )::int as "duplicate_count",
      count(*) filter (
        where "overall_status" = 'error'
          and "attention_status" <> 'resolved'
      )::int as "error_count",
      count(*) filter (
        where "overall_status" in ('duplicate', 'error')
          and "attention_status" <> 'resolved'
      )::int as "open_attention_count"
    from file_statuses
    group by "batch_id"
  ),
  successful_results as (
    select
      dr."id",
      dr."batch_id"
    from "document_results" dr
    inner join candidate_batches cb
      on cb."id" = dr."batch_id"
    inner join "intake_files" f
      on f."id" = dr."upload_id"
     and f."removed_from_batch_at" is null
    where dr."status" = 'success'
  ),
  signing_rollups as (
    select
      sr."batch_id",
      count(sr."id")::int as "certificate_count",
      count(sa."id") filter (where sa."status" = 'signed')::int as "signed_count"
    from successful_results sr
    left join "certificate_signed_artifacts" sa
      on sa."document_result_id" = sr."id"
     and sa."status" = 'signed'
    group by sr."batch_id"
  ),
  reconciliation_rollups as (
    select
      sr."batch_id",
      count(distinct rr."matched_tax_record_id")::int as "reconciled_count"
    from successful_results sr
    inner join "reconciliation_results" rr
      on rr."matched_tax_record_id" = sr."id"
     and rr."match_status" = 'matched'
     and rr."archived_at" is null
    group by sr."batch_id"
  ),
  batch_metrics as (
    select
      b."id",
      b."name",
      case
        when b."entity_id" is not null
          and nullif(trim(coalesce(b."entity_tin", '')), '') is not null
          then b."entity_id"
        else null
      end as "entity_id",
      case
        when b."entity_id" is not null
          and nullif(trim(coalesce(b."entity_tin", '')), '') is not null
          then b."entity_short_name"
        else null
      end as "entity_short_name",
      case
        when b."entity_id" is not null
          and nullif(trim(coalesce(b."entity_tin", '')), '') is not null
          then b."entity_company_name"
        else null
      end as "entity_company_name",
      case
        when b."entity_id" is not null
          and nullif(trim(coalesce(b."entity_tin", '')), '') is not null
          then b."entity_tin"
        else null
      end as "entity_tin",
      case
        when b."entity_id" is not null
          and nullif(trim(coalesce(b."entity_tin", '')), '') is not null
          then coalesce(
            nullif(trim(coalesce(b."entity_short_name", '')), ''),
            nullif(trim(coalesce(b."entity_company_name", '')), ''),
            nullif(trim(coalesce(b."entity_tin", '')), ''),
            'Unassigned'
          )
        else 'Unassigned'
      end as "entity_name",
      b."created_by_user_id",
      coalesce(
        nullif(trim(coalesce(u."name", '')), ''),
        nullif(trim(coalesce(u."email", '')), ''),
        b."created_by_user_id"
      ) as "owner_name",
      nullif(trim(coalesce(u."email", '')), '') as "owner_email",
      b."status" as "raw_status",
      case when b."status" = 'closed' then 'closed' else 'open' end as "display_status",
      case
        when b."total_files" > 0 then b."total_files"
        else coalesce(fr."active_file_count", 0)
      end::int as "total_files",
      coalesce(fr."open_attention_count", 0)::int as "open_attention_count",
      coalesce(fr."pending_count", 0)::int as "pending_count",
      coalesce(fr."uploaded_count", 0)::int as "uploaded_count",
      coalesce(fr."queued_count", 0)::int as "queued_count",
      coalesce(fr."processing_count", 0)::int as "processing_count",
      coalesce(fr."success_count", 0)::int as "success_count",
      coalesce(fr."duplicate_count", 0)::int as "duplicate_count",
      coalesce(fr."error_count", 0)::int as "error_count",
      coalesce(sr."certificate_count", 0)::int as "certificate_count",
      coalesce(sr."signed_count", 0)::int as "signed_count",
      coalesce(rr."reconciled_count", 0)::int as "reconciled_count",
      b."last_activity_at",
      b."closed_at",
      b."deleted_at",
      b."deleted_by_user_id",
      b."purge_after_at",
      b."created_at",
      b."updated_at"
    from candidate_batches b
    left join "user" u
      on u."id" = b."created_by_user_id"
    left join file_rollups fr
      on fr."batch_id" = b."id"
    left join signing_rollups sr
      on sr."batch_id" = b."id"
    left join reconciliation_rollups rr
      on rr."batch_id" = b."id"
  ),
  projected_batches as (
    select
      "id",
      "name",
      "entity_id" as "entityId",
      "entity_short_name" as "entityShortName",
      "entity_company_name" as "entityCompanyName",
      "entity_tin" as "entityTin",
      "entity_name" as "entityName",
      "created_by_user_id" as "createdByUserId",
      "owner_name" as "ownerName",
      "owner_email" as "ownerEmail",
      "display_status" as "status",
      case
        when "raw_status" = 'open' then 'Active'
        when "open_attention_count" > 0 then 'Needs Review'
        when "processing_count" > 0
          or "queued_count" > 0
          or "uploaded_count" > 0 then 'Processing'
        when "pending_count" > 0 then 'Pending'
        when "success_count" > 0
          and "duplicate_count" = 0
          and "error_count" = 0 then 'Completed'
        when "duplicate_count" > 0
          or "error_count" > 0 then 'Needs Review'
        else 'Completed'
      end as "overallStatus",
      (
        "raw_status" = 'closed'
          and "pending_count" = 0
          and "uploaded_count" = 0
          and "queued_count" = 0
          and "processing_count" = 0
          and "certificate_count" > 0
          and "reconciled_count" = "certificate_count"
          and "signed_count" <> "certificate_count"
      ) as "canSignBatch",
      case
        when not (
          "raw_status" = 'closed'
            and "pending_count" = 0
            and "uploaded_count" = 0
            and "queued_count" = 0
            and "processing_count" = 0
            and "certificate_count" > 0
            and "reconciled_count" = "certificate_count"
        ) then 'unavailable'
        when "signed_count" = "certificate_count" then 'signed'
        when "signed_count" > 0 then 'partial'
        else 'unsigned'
      end as "batchSigningStatus",
      "total_files" as "totalFiles",
      "open_attention_count" as "openAttentionCount",
      "pending_count" as "pendingCount",
      "uploaded_count" as "uploadedCount",
      "queued_count" as "queuedCount",
      "processing_count" as "processingCount",
      "success_count" as "successCount",
      "duplicate_count" as "duplicateCount",
      "error_count" as "errorCount",
      "last_activity_at" as "lastActivityAt",
      "closed_at" as "closedAt",
      "deleted_at" as "deletedAt",
      "deleted_by_user_id" as "deletedByUserId",
      "purge_after_at" as "purgeAfterAt",
      "created_at" as "createdAt",
      "updated_at" as "updatedAt"
    from batch_metrics
  )
`
}

const joinBatchListConditions = (conditions: Array<SQL>) =>
  conditions.length === 0
    ? sql`true`
    : sql.join(
        conditions.map((condition) => sql`(${condition})`),
        sql` and `,
      )

const toBatchListWhereSql = (conditions: Array<SQL>) =>
  conditions.length === 0
    ? sql``
    : sql`where ${joinBatchListConditions(conditions)}`

const buildBatchListBaseConditions = (
  input: BuildBatchListOptions,
  entityFilter: Awaited<ReturnType<typeof resolveEntityScopeFilterById>>,
): Array<SQL> => {
  const conditions: Array<SQL> = []
  const query = input.q.trim()

  if (query) {
    conditions.push(sql`
      concat_ws(
        ' ',
        coalesce("name", ''),
        "id"::text,
        coalesce("entityName", ''),
        coalesce("entityShortName", ''),
        coalesce("entityCompanyName", ''),
        coalesce("entityTin", ''),
        coalesce("ownerName", ''),
        coalesce("ownerEmail", '')
      ) ilike ${`%${escapeLikePattern(query)}%`} escape '\\'
    `)
  }

  if (entityFilter) {
    const candidates = [entityFilter.shortName, entityFilter.companyName]
      .map((value) => normalizeBatchListText(value))
      .filter(Boolean)
    const entityConditions = [
      sql`"entityId" = ${entityFilter.id}`,
      ...candidates.flatMap((candidate) => [
        sql`lower(trim(coalesce("entityShortName", ''))) = ${candidate}`,
        sql`lower(trim(coalesce("entityCompanyName", ''))) = ${candidate}`,
        sql`lower(trim(coalesce("entityName", ''))) = ${candidate}`,
      ]),
    ]

    conditions.push(sql`${sql.join(entityConditions, sql` or `)}`)
  } else if ((input.entityId ?? '').trim()) {
    conditions.push(sql`false`)
  } else {
    const entity = normalizeBatchListText(input.entity)
    if (entity) {
      conditions.push(sql`
        lower(trim(coalesce("entityName", ''))) = ${entity}
          or lower(trim(coalesce("entityShortName", ''))) = ${entity}
          or lower(trim(coalesce("entityCompanyName", ''))) = ${entity}
      `)
    }
  }

  if (input.signingStatus !== 'all') {
    conditions.push(sql`"batchSigningStatus" = ${input.signingStatus}`)
  }

  if (input.attention === 'needs_attention') {
    conditions.push(sql`"openAttentionCount" > 0`)
  } else if (input.attention === 'clear') {
    conditions.push(sql`"openAttentionCount" = 0`)
  }

  if (input.reconciliationEligible === true) {
    conditions.push(sql`"status" = 'closed' and "successCount" > 0`)
  }

  return conditions
}

const buildBatchListStatusConditions = (
  input: BuildBatchListOptions,
): Array<SQL> => {
  const status = normalizeBatchListText(input.status)
  if (!status || status === 'all') return []

  return [sql`lower("overallStatus") = ${status}`]
}

const normalizeBatchSigningStatus = (
  value: unknown,
): IntakeBatchView['batchSigningStatus'] =>
  batchListSigningStatusOrder.includes(
    value as IntakeBatchView['batchSigningStatus'],
  )
    ? (value as IntakeBatchView['batchSigningStatus'])
    : 'unavailable'

const mapBatchListSqlRow = (row: BatchListSqlRow): BatchListRow => ({
  id: row.id,
  name: row.name,
  filesMode: 'summary',
  entity:
    row.entityId && row.entityTin
      ? {
          id: Number(row.entityId),
          shortName: row.entityShortName,
          companyName: row.entityCompanyName,
          tin: row.entityTin,
        }
      : null,
  createdByUserId: row.createdByUserId,
  status: row.status === 'closed' ? 'closed' : 'open',
  overallStatus: row.overallStatus,
  canSignBatch: row.canSignBatch === true,
  batchSigningStatus: normalizeBatchSigningStatus(row.batchSigningStatus),
  totalFiles: toBatchListNumber(row.totalFiles),
  openAttentionCount: toBatchListNumber(row.openAttentionCount),
  counts: {
    pending: toBatchListNumber(row.pendingCount),
    uploaded: toBatchListNumber(row.uploadedCount),
    queued: toBatchListNumber(row.queuedCount),
    processing: toBatchListNumber(row.processingCount),
    success: toBatchListNumber(row.successCount),
    duplicate: toBatchListNumber(row.duplicateCount),
    error: toBatchListNumber(row.errorCount),
  },
  lastActivityAt: toBatchListIsoString(row.lastActivityAt),
  closedAt: toBatchListIsoString(row.closedAt),
  deletedAt: toBatchListIsoString(row.deletedAt),
  deletedByUserId: row.deletedByUserId,
  purgeAfterAt: toBatchListIsoString(row.purgeAfterAt),
  createdAt: toBatchListIsoString(row.createdAt),
  updatedAt: toBatchListIsoString(row.updatedAt),
  entityName: row.entityName || 'Unassigned',
  ownerName: row.ownerName?.trim() || row.createdByUserId,
  ownerEmail: row.ownerEmail?.trim() || null,
})

const toBatchListStatuses = (value: unknown): Array<string> =>
  Array.isArray(value)
    ? value.filter((status): status is string => typeof status === 'string')
    : []

const parseBatchListPageRows = (value: unknown): Array<BatchListSqlRow> => {
  if (Array.isArray(value)) {
    return value as Array<BatchListSqlRow>
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? (parsed as Array<BatchListSqlRow>) : []
    } catch {
      return []
    }
  }

  return []
}

const buildBatchSigningFilterOptions = (
  metadata: BatchListMetadataSqlRow | undefined,
) => {
  if (!metadata) return []

  return batchListSigningStatusOrder.filter((status) => {
    switch (status) {
      case 'unavailable':
        return metadata.hasUnavailable
      case 'unsigned':
        return metadata.hasUnsigned
      case 'partial':
        return metadata.hasPartial
      case 'signed':
        return metadata.hasSigned
      default:
        return false
    }
  })
}

export const listUploadBatches = async (
  input: BuildBatchListOptions,
): Promise<BatchListResponse> => {
  const db = getDb()
  const entityFilter = await resolveEntityScopeFilterById(input.entityId)
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.max(1, input.pageSize ?? 25)
  const offset = (page - 1) * pageSize
  const baseConditions = buildBatchListBaseConditions(input, entityFilter)
  const statusConditions = buildBatchListStatusConditions(input)
  const filteredConditions = [...baseConditions, ...statusConditions]
  const basePredicate = joinBatchListConditions(baseConditions)
  const filteredPredicate = joinBatchListConditions(filteredConditions)
  const projectionSql = buildBatchListProjectionSql(input.repository)

  const listQuery = sql<BatchListCombinedSqlRow>`
    with ${projectionSql},
    metadata as (
      select
      count(*) filter (where ${basePredicate})::int as "total",
      count(*) filter (
        where (${basePredicate}) and "overallStatus" = 'Active'
      )::int as "active",
      count(*) filter (
        where (${basePredicate}) and "overallStatus" = 'Needs Review'
      )::int as "needsReview",
      count(*) filter (
        where (${basePredicate}) and "overallStatus" = 'Completed'
      )::int as "completed",
      count(*) filter (where ${filteredPredicate})::int as "totalItems",
      coalesce(
        array_agg(distinct "overallStatus" order by "overallStatus")
          filter (where (${basePredicate}) and "overallStatus" is not null),
        array[]::text[]
      ) as "statuses",
      coalesce(
        bool_or("batchSigningStatus" = 'unavailable')
          filter (where ${basePredicate}),
        false
      ) as "hasUnavailable",
      coalesce(
        bool_or("batchSigningStatus" = 'unsigned')
          filter (where ${basePredicate}),
        false
      ) as "hasUnsigned",
      coalesce(
        bool_or("batchSigningStatus" = 'partial')
          filter (where ${basePredicate}),
        false
      ) as "hasPartial",
      coalesce(
        bool_or("batchSigningStatus" = 'signed')
          filter (where ${basePredicate}),
        false
      ) as "hasSigned"
      from projected_batches
    ),
    filtered_batches as (
      select *
      from projected_batches
      ${toBatchListWhereSql(filteredConditions)}
    ),
    page_rows as (
      select
        "id",
        "name",
        "entityId",
        "entityShortName",
        "entityCompanyName",
        "entityTin",
        "entityName",
        "createdByUserId",
        "ownerName",
        "ownerEmail",
        "status",
        "overallStatus",
        "canSignBatch",
        "batchSigningStatus",
        "totalFiles",
        "openAttentionCount",
        "pendingCount",
        "uploadedCount",
        "queuedCount",
        "processingCount",
        "successCount",
        "duplicateCount",
        "errorCount",
        "lastActivityAt",
        "closedAt",
        "deletedAt",
        "deletedByUserId",
        "purgeAfterAt",
        "createdAt",
        "updatedAt",
        row_number() over (
          order by "lastActivityAt" desc, "createdAt" desc
        ) as "__rowPosition"
      from filtered_batches
      order by "lastActivityAt" desc, "createdAt" desc
      limit ${pageSize}
      offset ${offset}
    ),
    page_payload as (
      select coalesce(
        jsonb_agg(
          to_jsonb(page_rows) - '__rowPosition'
          order by page_rows."__rowPosition"
        ),
        '[]'::jsonb
      ) as "pageRows"
      from page_rows
    )
    select
      metadata."total",
      metadata."active",
      metadata."needsReview",
      metadata."completed",
      metadata."totalItems",
      metadata."statuses",
      metadata."hasUnavailable",
      metadata."hasUnsigned",
      metadata."hasPartial",
      metadata."hasSigned",
      page_payload."pageRows"
    from metadata
    cross join page_payload
  `

  const result = await db.execute<BatchListCombinedSqlRow>(listQuery)
  const metadata = result.rows.at(0)
  const pageRows = parseBatchListPageRows(metadata?.pageRows)
  const totalItems = toBatchListNumber(metadata?.totalItems)
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  return {
    batches: pageRows.map(mapBatchListSqlRow),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: page * pageSize < totalItems,
      hasPreviousPage: page > 1,
    },
    summary: {
      total: toBatchListNumber(metadata?.total),
      active: toBatchListNumber(metadata?.active),
      needsReview: toBatchListNumber(metadata?.needsReview),
      completed: toBatchListNumber(metadata?.completed),
    },
    filterOptions: {
      statuses: toBatchListStatuses(metadata?.statuses),
      signingStatuses: buildBatchSigningFilterOptions(metadata),
    },
  }
}

const batchFileStatusOrder: Array<Exclude<BatchFileStatusFilter, 'all'>> = [
  'pending',
  'uploaded',
  'queued',
  'processing',
  'success',
  'duplicate',
  'error',
]

type BatchFilesMetadataSqlRow = {
  totalItems: number
  hasPending: boolean
  hasUploaded: boolean
  hasQueued: boolean
  hasProcessing: boolean
  hasSuccess: boolean
  hasDuplicate: boolean
  hasError: boolean
}

type BatchFilePageSqlRow = {
  id: string
}

const batchFileStatusMetadataKeys = {
  pending: 'hasPending',
  uploaded: 'hasUploaded',
  queued: 'hasQueued',
  processing: 'hasProcessing',
  success: 'hasSuccess',
  duplicate: 'hasDuplicate',
  error: 'hasError',
} satisfies Record<
  Exclude<BatchFileStatusFilter, 'all'>,
  keyof BatchFilesMetadataSqlRow
>

const batchFileProjectionSql = (batchId: string) => sql`
  projected_files as (
    select
      f."id",
      f."original_file_name",
      f."sanitized_file_name",
      f."storage_key",
      f."current_phase",
      f."current_step",
      f."error_message",
      f."created_at",
      case
        when f."processing_status" = 'success' then 'success'
        when f."processing_status" = 'duplicate' then 'duplicate'
        when f."processing_status" = 'error' then 'error'
        when f."processing_status" = 'processing' then 'processing'
        when f."queue_status" = 'failed' then 'error'
        when f."queue_status" in ('queued', 'sending') then 'queued'
        when f."upload_status" = 'uploaded' then 'uploaded'
        else 'pending'
      end as "overallStatus",
      (
        case
          when f."processing_status" = 'success' then 'success'
          when f."processing_status" = 'duplicate' then 'duplicate'
          when f."processing_status" = 'error' then 'error'
          when f."processing_status" = 'processing' then 'processing'
          when f."queue_status" = 'failed' then 'error'
          when f."queue_status" in ('queued', 'sending') then 'queued'
          when f."upload_status" = 'uploaded' then 'uploaded'
          else 'pending'
        end in ('duplicate', 'error')
        and coalesce(f."attention_status", 'open') <> 'resolved'
      ) as "hasOpenAttention"
    from "intake_files" f
    where f."batch_id" = ${batchId}
      and f."removed_from_batch_at" is null
  )
`

const buildBatchFileConditions = (input: BatchFilesSearch): Array<SQL> => {
  const conditions: Array<SQL> = []
  const query = input.q.trim()

  if (query) {
    conditions.push(sql`
      concat_ws(
        ' ',
        coalesce("original_file_name", ''),
        coalesce("sanitized_file_name", ''),
        coalesce("storage_key", ''),
        coalesce("current_phase", ''),
        coalesce("current_step", ''),
        coalesce("error_message", '')
      ) ilike ${`%${escapeLikePattern(query)}%`} escape '\\'
    `)
  }

  if (input.status !== 'all') {
    conditions.push(sql`"overallStatus" = ${input.status}`)
  }

  if (input.attention === 'open') {
    conditions.push(sql`"hasOpenAttention" = true`)
  }

  return conditions
}

const buildBatchFileFilterOptions = (
  metadata: BatchFilesMetadataSqlRow | undefined,
) => {
  if (!metadata) {
    return {
      statuses: [],
    }
  }

  return {
    statuses: batchFileStatusOrder.filter(
      (status) => metadata[batchFileStatusMetadataKeys[status]],
    ),
  }
}

export const listUploadBatchFiles = async (
  input: BatchFilesSearch & {
    batchId: string
  },
): Promise<
  | {
      status: 'ok'
      result: BatchFilesResponse
    }
  | {
      status: 'not_found'
      result: null
    }
> => {
  const batchRecord = await getBatchRecordById(input.batchId)
  if (!batchRecord) {
    return {
      status: 'not_found',
      result: null,
    }
  }

  const db = getDb()
  const page = Math.max(1, input.page)
  const pageSize = Math.max(1, input.pageSize)
  const offset = (page - 1) * pageSize
  const conditions = buildBatchFileConditions(input)
  const filteredPredicate = joinBatchListConditions(conditions)
  const metadataQuery = sql<BatchFilesMetadataSqlRow>`
    with ${batchFileProjectionSql(batchRecord.id)}
    select
      count(*) filter (where ${filteredPredicate})::int as "totalItems",
      coalesce(bool_or("overallStatus" = 'pending'), false) as "hasPending",
      coalesce(bool_or("overallStatus" = 'uploaded'), false) as "hasUploaded",
      coalesce(bool_or("overallStatus" = 'queued'), false) as "hasQueued",
      coalesce(bool_or("overallStatus" = 'processing'), false) as "hasProcessing",
      coalesce(bool_or("overallStatus" = 'success'), false) as "hasSuccess",
      coalesce(bool_or("overallStatus" = 'duplicate'), false) as "hasDuplicate",
      coalesce(bool_or("overallStatus" = 'error'), false) as "hasError"
    from projected_files
  `
  const pageIdsQuery = sql<BatchFilePageSqlRow>`
    with ${batchFileProjectionSql(batchRecord.id)}
    select "id"
    from projected_files
    where ${filteredPredicate}
    order by "created_at" desc
    limit ${pageSize}
    offset ${offset}
  `
  const [metadataResult, pageIdsResult] = await Promise.all([
    db.execute<BatchFilesMetadataSqlRow>(metadataQuery),
    db.execute<BatchFilePageSqlRow>(pageIdsQuery),
  ])
  const metadata = metadataResult.rows.at(0)
  const filterOptions = buildBatchFileFilterOptions(metadata)
  const totalItems = toSqlNumber(metadata?.totalItems)
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const uploadIds = pageIdsResult.rows.map((row) => row.id)

  if (uploadIds.length === 0) {
    return {
      status: 'ok',
      result: {
        files: [],
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
          hasNextPage: page * pageSize < totalItems,
          hasPreviousPage: page > 1,
        },
        filterOptions,
      },
    }
  }

  const [pageFiles, jobs, results] = await Promise.all([
    db
      .select()
      .from(intakeFiles)
      .where(inArray(intakeFiles.id, uploadIds))
      .orderBy(desc(intakeFiles.createdAt)),
    db
      .select()
      .from(workerJobs)
      .where(inArray(workerJobs.uploadId, uploadIds))
      .orderBy(desc(workerJobs.createdAt)),
    db
      .select()
      .from(documentResults)
      .where(inArray(documentResults.uploadId, uploadIds))
      .orderBy(desc(documentResults.createdAt)),
  ])

  return {
    status: 'ok',
    result: {
      files: mapUploadViews(pageFiles, jobs, results),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasNextPage: page * pageSize < totalItems,
        hasPreviousPage: page > 1,
      },
      filterOptions,
    },
  }
}

const getBatchPreviewView = async (
  batch: IntakeBatchRecord,
): Promise<IntakeBatchView> => {
  const [summary, preview] = await Promise.all([
    getBatchSummaryView(batch),
    listUploadBatchFiles({
      batchId: batch.id,
      q: '',
      status: 'all',
      attention: 'all',
      page: 1,
      pageSize: ACTIVE_BATCH_PREVIEW_PAGE_SIZE,
    }),
  ])

  return {
    ...summary,
    filesMode: 'preview',
    files: preview.status === 'ok' ? preview.result.files : [],
  }
}

export const renameUploadBatch = async (input: {
  batchId: string
  userId?: string
  name: string | null
}) => {
  const batchRecord = await getBatchRecordById(input.batchId)

  if (!batchRecord) {
    return {
      status: 'not_found' as const,
      batch: null,
    }
  }

  if (isBatchDeleted(batchRecord)) {
    return {
      status: 'not_found' as const,
      batch: null,
    }
  }

  if (input.userId && batchRecord.createdByUserId !== input.userId) {
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
    batch: await getBatchSummaryViewById(batchRecord.id),
  }
}

export const deleteUploadBatch = async (input: {
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

  if (isBatchDeleted(batchRecord)) {
    return {
      status: 'ok' as const,
      batch: await getBatchSummaryViewById(batchRecord.id),
    }
  }

  if (batchRecord.status !== 'closed') {
    return {
      status: 'invalid_state' as const,
      batch: await getBatchSummaryView(batchRecord),
    }
  }

  const now = new Date()
  const purgeAfterAt = addDays(now, BATCH_DELETE_RETENTION_DAYS)
  const db = getDb()

  await db
    .update(intakeBatches)
    .set({
      deletedAt: now,
      deletedByUserId: input.userId,
      purgeAfterAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(intakeBatches.id, batchRecord.id),
        isNull(intakeBatches.deletedAt),
      ),
    )

  return {
    status: 'ok' as const,
    batch: await getBatchSummaryViewById(batchRecord.id),
  }
}

export const restoreUploadBatch = async (input: {
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

  if (!isBatchDeleted(batchRecord)) {
    return {
      status: 'ok' as const,
      batch: await getBatchSummaryViewById(batchRecord.id),
    }
  }

  const now = new Date()
  if (batchRecord.purgeAfterAt && batchRecord.purgeAfterAt <= now) {
    return {
      status: 'expired' as const,
      batch: await getBatchSummaryView(batchRecord),
    }
  }

  const db = getDb()
  await db
    .update(intakeBatches)
    .set({
      deletedAt: null,
      deletedByUserId: null,
      purgeAfterAt: null,
      updatedAt: now,
    })
    .where(eq(intakeBatches.id, batchRecord.id))

  return {
    status: 'ok' as const,
    batch: await getBatchSummaryViewById(batchRecord.id),
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

    if (isBatchDeleted(batchRecord)) {
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
          isNull(intakeBatches.deletedAt),
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
    batch: await getBatchSummaryViewById(result.batchId),
  }
}

export const completeUploadAndQueue = async (input: {
  uploadId: string
  uploadStartedAt?: string
  uploadFinishedAt?: string
}) => {
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
  if (isBatchDeleted(batch)) {
    throw new Error('Upload batch has been deleted.')
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

  if (file.sizeBytes > MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES) {
    throw new Error(
      `${file.originalFileName} exceeds the ${MAX_INTAKE_UPLOAD_FILE_SIZE_LABEL} upload limit.`,
    )
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

  if (contentLength > MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES) {
    throw new Error(
      `${file.originalFileName} exceeds the ${MAX_INTAKE_UPLOAD_FILE_SIZE_LABEL} upload limit.`,
    )
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

  if (input.uploadStartedAt && input.uploadFinishedAt) {
    await recordBatchStageTiming({
      batchId: file.batchId,
      stage: 'upload',
      startedAt: new Date(input.uploadStartedAt),
      finishedAt: new Date(input.uploadFinishedAt),
      dedupeKey: `upload:${file.id}`,
      sourceType: 'upload',
      sourceId: file.id,
      metadata: {
        fileName: file.originalFileName,
        sizeBytes: file.sizeBytes,
      },
    }).catch(logBatchStageTimingError)
  }

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

  return getBatchSummaryViewById(batch.id)
}

export const closeUploadBatch = async (input: {
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

  if (isBatchDeleted(batchRecord)) {
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

  if (batchRecord.status !== 'open') {
    return {
      status: 'ok' as const,
      batch: await getBatchSummaryViewById(batchRecord.id),
    }
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
    .where(eq(intakeBatches.id, batchRecord.id))

  return {
    status: 'ok' as const,
    batch: await getBatchSummaryViewById(batchRecord.id),
  }
}

export const listRecentUploads = async (userId: string, limit = 10) => {
  const db = getDb()
  const activeBatchRecord = await getOpenBatchRecord(userId)

  const recentBatchRecords = await db
    .select()
    .from(intakeBatches)
    .where(
      and(
        eq(intakeBatches.createdByUserId, userId),
        isNull(intakeBatches.deletedAt),
      ),
    )
    .orderBy(desc(intakeBatches.lastActivityAt), desc(intakeBatches.createdAt))
    .limit(limit + (activeBatchRecord ? 1 : 0))

  const filteredRecentRecords = activeBatchRecord
    ? recentBatchRecords.filter((batch) => batch.id !== activeBatchRecord.id)
    : recentBatchRecords

  const [activeBatch, recentBatches] = await Promise.all([
    activeBatchRecord
      ? getBatchPreviewView(activeBatchRecord)
      : Promise.resolve(null),
    Promise.all(
      filteredRecentRecords
        .slice(0, limit)
        .map((batch) => getBatchSummaryView(batch)),
    ),
  ])

  const batches = activeBatch ? [activeBatch, ...recentBatches] : recentBatches

  return {
    activeBatch,
    recentBatches,
    summary: sumStatusSummaries(batches),
  }
}

export { isPdfFileUpload, uploadCreateSchema }
