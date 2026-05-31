import { DeleteObjectsCommand, type S3Client } from '@aws-sdk/client-s3'
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm'

import { createS3ServerClient, getStorageBucketName } from '@/lib/aws-server'
import { getDb } from '@/lib/db'
import {
  batchStageTimings,
  certificateMergeJobInputs,
  certificateMergeJobOutputs,
  certificateMergeJobs,
  certificateSignedArtifacts,
  documentResults,
  intakeBatches,
  intakeFiles,
  reconciliationResults,
  salesReportRunBatches,
  securityAuditLogs,
  workerIdempotency,
  workerJobs,
  workerJobSteps,
} from '@/lib/schema'

const DELETE_OBJECT_CHUNK_SIZE = 1000
const DEFAULT_PURGE_LIMIT = 25

type BatchPurgeState = {
  batchId: string
  resultIds: Array<number>
  mergeJobIds: Array<string>
  workerJobIds: Array<string>
  objectKeys: Array<string>
}

export type PurgeExpiredBatchesOptions = {
  now?: Date
  limit?: number
  bucket?: string
  s3?: S3Client
  onError?: (error: unknown, context: Record<string, unknown>) => void
}

export type PurgedBatchSummary = {
  batchId: string
  objectKeyCount: number
  failedObjectDeleteCount: number
}

const chunkItems = <T>(items: Array<T>, size: number) => {
  const chunks: Array<Array<T>> = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

const normalizeObjectKey = (value: unknown, bucket: string): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith('s3://')) {
    const withoutScheme = trimmed.slice('s3://'.length)
    const separatorIndex = withoutScheme.indexOf('/')
    if (separatorIndex === -1) {
      return null
    }

    const objectBucket = withoutScheme.slice(0, separatorIndex)
    const key = withoutScheme.slice(separatorIndex + 1)
    return objectBucket === bucket && key ? key : null
  }

  return trimmed
}

const collectArtifactKeyValues = (
  value: unknown,
  bucket: string,
  keys: Set<string>,
) => {
  const key = normalizeObjectKey(value, bucket)
  if (key) {
    keys.add(key)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifactKeyValues(item, bucket, keys)
    }
    return
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectArtifactKeyValues(item, bucket, keys)
    }
  }
}

const collectArtifactKeysFromPayload = (
  value: unknown,
  bucket: string,
  keys: Set<string>,
) => {
  if (!value || typeof value !== 'object') {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifactKeysFromPayload(item, bucket, keys)
    }
    return
  }

  for (const [property, propertyValue] of Object.entries(value)) {
    if (property === 'artifactKeys') {
      collectArtifactKeyValues(propertyValue, bucket, keys)
      continue
    }

    if (property === 'source' && Array.isArray(propertyValue)) {
      collectArtifactKeyValues(propertyValue, bucket, keys)
      continue
    }

    const key = [
      'source',
      'rawResultJson',
      'finalResultJson',
      'renamedPdf',
    ].includes(property)
      ? normalizeObjectKey(propertyValue, bucket)
      : null

    if (key) {
      keys.add(key)
    }

    if (propertyValue && typeof propertyValue === 'object') {
      collectArtifactKeysFromPayload(propertyValue, bucket, keys)
    }
  }
}

const collectBatchPurgeState = async (
  batchId: string,
  bucket: string,
): Promise<BatchPurgeState> => {
  const db = getDb()
  const [files, results, jobs] = await Promise.all([
    db
      .select({
        storageKey: intakeFiles.storageKey,
        artifactUri: intakeFiles.artifactUri,
      })
      .from(intakeFiles)
      .where(eq(intakeFiles.batchId, batchId)),
    db
      .select({
        id: documentResults.id,
        finalKey: documentResults.finalKey,
        artifactKey: documentResults.artifactKey,
        payload: documentResults.payload,
      })
      .from(documentResults)
      .where(eq(documentResults.batchId, batchId)),
    db
      .select({ jobId: workerJobs.jobId })
      .from(workerJobs)
      .where(eq(workerJobs.batchId, batchId)),
  ])
  const objectKeys = new Set<string>()

  for (const file of files) {
    for (const value of [file.storageKey, file.artifactUri]) {
      const key = normalizeObjectKey(value, bucket)
      if (key) {
        objectKeys.add(key)
      }
    }
  }

  for (const result of results) {
    for (const value of [result.finalKey, result.artifactKey]) {
      const key = normalizeObjectKey(value, bucket)
      if (key) {
        objectKeys.add(key)
      }
    }
    collectArtifactKeysFromPayload(result.payload, bucket, objectKeys)
  }

  const resultIds = results.map((result) => result.id)
  const [signedArtifacts, mergeInputs] =
    resultIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              sourcePdfKey: certificateSignedArtifacts.sourcePdfKey,
              signedPdfKey: certificateSignedArtifacts.signedPdfKey,
            })
            .from(certificateSignedArtifacts)
            .where(
              inArray(certificateSignedArtifacts.documentResultId, resultIds),
            ),
          db
            .select({ mergeJobId: certificateMergeJobInputs.mergeJobId })
            .from(certificateMergeJobInputs)
            .where(
              inArray(certificateMergeJobInputs.documentResultId, resultIds),
            ),
        ])

  for (const artifact of signedArtifacts) {
    for (const value of [artifact.sourcePdfKey, artifact.signedPdfKey]) {
      const key = normalizeObjectKey(value, bucket)
      if (key) {
        objectKeys.add(key)
      }
    }
  }

  const mergeJobIds = Array.from(
    new Set(mergeInputs.map((input) => input.mergeJobId)),
  )
  const mergeOutputs =
    mergeJobIds.length === 0
      ? []
      : await db
          .select({ outputKey: certificateMergeJobOutputs.outputKey })
          .from(certificateMergeJobOutputs)
          .where(inArray(certificateMergeJobOutputs.mergeJobId, mergeJobIds))

  for (const output of mergeOutputs) {
    const key = normalizeObjectKey(output.outputKey, bucket)
    if (key) {
      objectKeys.add(key)
    }
  }

  return {
    batchId,
    resultIds,
    mergeJobIds,
    workerJobIds: jobs.map((job) => job.jobId),
    objectKeys: Array.from(objectKeys),
  }
}

const deleteS3Objects = async (
  s3: S3Client,
  bucket: string,
  keys: Array<string>,
  onError: PurgeExpiredBatchesOptions['onError'],
) => {
  let failedObjectDeleteCount = 0

  for (const chunk of chunkItems(keys, DELETE_OBJECT_CHUNK_SIZE)) {
    try {
      const response = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      )
      failedObjectDeleteCount += response.Errors?.length ?? 0
    } catch (error) {
      failedObjectDeleteCount += chunk.length
      onError?.(error, {
        bucket,
        objectCount: chunk.length,
      })
    }
  }

  return failedObjectDeleteCount
}

const purgeBatchRows = async (state: BatchPurgeState, purgedAt: Date) => {
  const db = getDb()

  await db.transaction(async (tx) => {
    if (state.mergeJobIds.length > 0) {
      await tx
        .delete(certificateMergeJobs)
        .where(inArray(certificateMergeJobs.id, state.mergeJobIds))
    }

    if (state.workerJobIds.length > 0) {
      await tx
        .delete(workerJobSteps)
        .where(inArray(workerJobSteps.jobId, state.workerJobIds))
      await tx
        .delete(workerIdempotency)
        .where(inArray(workerIdempotency.jobId, state.workerJobIds))
    }

    if (state.resultIds.length > 0) {
      await tx
        .update(reconciliationResults)
        .set({
          matchedTaxRecordId: null,
          matchedUploadBatchId: null,
          archivedAt: purgedAt,
          updatedAt: purgedAt,
        })
        .where(
          or(
            inArray(reconciliationResults.matchedTaxRecordId, state.resultIds),
            eq(reconciliationResults.matchedUploadBatchId, state.batchId),
            eq(reconciliationResults.uploadBatchId, state.batchId),
          ),
        )
    } else {
      await tx
        .update(reconciliationResults)
        .set({
          matchedUploadBatchId: null,
          archivedAt: purgedAt,
          updatedAt: purgedAt,
        })
        .where(
          or(
            eq(reconciliationResults.matchedUploadBatchId, state.batchId),
            eq(reconciliationResults.uploadBatchId, state.batchId),
          ),
        )
    }

    await tx
      .delete(salesReportRunBatches)
      .where(eq(salesReportRunBatches.batchId, state.batchId))

    await tx
      .delete(batchStageTimings)
      .where(eq(batchStageTimings.batchId, state.batchId))

    await tx.delete(intakeBatches).where(eq(intakeBatches.id, state.batchId))

    await tx.insert(securityAuditLogs).values({
      eventType: 'batch_purged',
      targetId: state.batchId,
      targetType: 'batch',
      metadata: {
        purgedAt: purgedAt.toISOString(),
        objectKeyCount: state.objectKeys.length,
      },
    })
  })
}

export const purgeExpiredUploadBatches = async (
  options: PurgeExpiredBatchesOptions = {},
): Promise<Array<PurgedBatchSummary>> => {
  const db = getDb()
  const now = options.now ?? new Date()
  const limit = Math.max(1, options.limit ?? DEFAULT_PURGE_LIMIT)
  const bucket = options.bucket ?? getStorageBucketName()
  const s3 = options.s3 ?? createS3ServerClient()
  const batches = await db
    .select({ id: intakeBatches.id })
    .from(intakeBatches)
    .where(
      and(
        sql`${intakeBatches.deletedAt} is not null`,
        lte(intakeBatches.purgeAfterAt, now),
      ),
    )
    .orderBy(intakeBatches.purgeAfterAt, intakeBatches.deletedAt)
    .limit(limit)
  const summaries: Array<PurgedBatchSummary> = []

  for (const batch of batches) {
    const state = await collectBatchPurgeState(batch.id, bucket)
    const failedObjectDeleteCount = await deleteS3Objects(
      s3,
      bucket,
      state.objectKeys,
      options.onError,
    )

    await purgeBatchRows(state, now)
    summaries.push({
      batchId: batch.id,
      objectKeyCount: state.objectKeys.length,
      failedObjectDeleteCount,
    })
  }

  return summaries
}
