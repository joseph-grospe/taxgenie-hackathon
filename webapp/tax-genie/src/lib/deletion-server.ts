import { and, eq, sql } from 'drizzle-orm'

import type { DeletionEligibility, PurgeStatus } from '@/lib/deletion-types'
import { eligibleForDeletion } from '@/lib/deletion-types'
import { getDb } from '@/lib/db'
import { requireFeature } from '@/lib/feature-flags-server'
import { resolveOverallStatus } from '@/lib/intake-utils'
import { intakeBatches, intakeFiles } from '@/lib/schema'

type IntakeFileRecord = typeof intakeFiles.$inferSelect

type UploadProtectionRow = {
  uploadId: string
  batchDeleted: boolean
  hasSignedCertificate: boolean
  hasMergeInput: boolean
}

type BatchProtectionRow = {
  hasSignedCertificate: boolean
  hasMergeInput: boolean
  hasFilePurge: boolean
  purgeStatus?: PurgeStatus | null
}

type BatchProtectionWithIdRow = BatchProtectionRow & { batchId: string }

const ACTIVE_PURGE_STATUSES = new Set<PurgeStatus>(['queued', 'running'])
const TERMINAL_UPLOAD_STATUSES = new Set(['success', 'duplicate', 'error'])

const notEligible = (
  code: Exclude<DeletionEligibility['code'], 'eligible'>,
  reason: string,
): DeletionEligibility => ({ canDelete: false, code, reason })

const toBoolean = (value: unknown) => value === true || value === 'true'

const sanitizePurgeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.replaceAll(/\s+/g, ' ').trim().slice(0, 500)
}

const getUploadProtectionRows = async (
  uploadIds: Array<string>,
): Promise<Map<string, UploadProtectionRow>> => {
  if (uploadIds.length === 0) return new Map()

  const db = getDb()
  const result = await db.execute<UploadProtectionRow>(sql`
    select
      f."id" as "uploadId",
      (b."deleted_at" is not null) as "batchDeleted",
      exists (
        select 1
        from "document_results" dr
        inner join "extracted_certificates" ec
          on ec."document_result_id" = dr."id"
        inner join "certificate_signed_artifacts" sa
          on sa."certificate_id" = ec."id"
         and sa."status" = 'signed'
        where dr."upload_id" = f."id"
      ) as "hasSignedCertificate",
      exists (
        select 1
        from "document_results" dr
        inner join "extracted_certificates" ec
          on ec."document_result_id" = dr."id"
        inner join "certificate_merge_job_inputs" mi
          on mi."certificate_id" = ec."id"
        where dr."upload_id" = f."id"
      ) as "hasMergeInput"
    from "intake_files" f
    inner join "intake_batches" b on b."id" = f."batch_id"
    where f."id" in (${sql.join(
      uploadIds.map((uploadId) => sql`${uploadId}::uuid`),
      sql`, `,
    )})
  `)
  const rows = (result as { rows?: Array<UploadProtectionRow> } | undefined)
    ?.rows

  return new Map(
    (rows ?? []).map((row) => [
      row.uploadId,
      {
        uploadId: row.uploadId,
        batchDeleted: toBoolean(row.batchDeleted),
        hasSignedCertificate: toBoolean(row.hasSignedCertificate),
        hasMergeInput: toBoolean(row.hasMergeInput),
      },
    ]),
  )
}

export const getUploadDeletionEligibilityMap = async (
  files: Array<IntakeFileRecord>,
): Promise<Map<string, DeletionEligibility>> => {
  const protectionByUploadId = await getUploadProtectionRows(
    files.map((file) => file.id),
  )

  return new Map(
    files.map((file) => {
      const protection = protectionByUploadId.get(file.id)
      return [file.id, resolveUploadDeletionEligibility(file, protection)]
    }),
  )
}

export const resolveUploadDeletionEligibility = (
  file: IntakeFileRecord,
  protection?: Omit<UploadProtectionRow, 'uploadId'>,
): DeletionEligibility => {
  if (protection?.batchDeleted) {
    return notEligible(
      'batch_deleted',
      'Restore the Recently Deleted batch or permanently delete the whole batch.',
    )
  }
  if (
    file.purgeStatus &&
    ACTIVE_PURGE_STATUSES.has(file.purgeStatus as PurgeStatus)
  ) {
    return notEligible(
      'purge_in_progress',
      'Permanent deletion is already in progress.',
    )
  }
  if (protection?.hasMergeInput) {
    return notEligible(
      'merged',
      'This certificate has been included in a PDF merge and cannot be deleted.',
    )
  }
  if (protection?.hasSignedCertificate) {
    return notEligible(
      'signed',
      'This certificate has been signed and cannot be deleted.',
    )
  }
  if (!TERMINAL_UPLOAD_STATUSES.has(resolveOverallStatus(file))) {
    return notEligible(
      'processing',
      'Wait for upload and extraction processing to finish before deleting this file.',
    )
  }

  return eligibleForDeletion()
}

export const resolveBatchDeletionEligibility = (
  protection?: BatchProtectionRow,
): DeletionEligibility => {
  if (
    protection?.purgeStatus &&
    ACTIVE_PURGE_STATUSES.has(protection.purgeStatus)
  ) {
    return notEligible(
      'purge_in_progress',
      'Permanent deletion is already in progress.',
    )
  }
  if (toBoolean(protection?.hasFilePurge)) {
    return notEligible(
      'purge_in_progress',
      'Wait for file deletion to finish before deleting this batch.',
    )
  }
  if (toBoolean(protection?.hasMergeInput)) {
    return notEligible(
      'merged',
      'This batch contains certificates included in a PDF merge and cannot be deleted.',
    )
  }
  if (toBoolean(protection?.hasSignedCertificate)) {
    return notEligible(
      'signed',
      'This batch contains signed certificates and cannot be deleted.',
    )
  }

  return eligibleForDeletion()
}

export const getBatchDeletionEligibilityMap = async (
  batchIds: Array<string>,
): Promise<Map<string, DeletionEligibility>> => {
  if (batchIds.length === 0) return new Map()
  const db = getDb()
  const result = await db.execute<BatchProtectionWithIdRow>(sql`
    select
      b."id" as "batchId",
      b."purge_status" as "purgeStatus",
      exists (
        select 1
        from "document_results" dr
        inner join "extracted_certificates" ec
          on ec."document_result_id" = dr."id"
        inner join "certificate_signed_artifacts" sa
          on sa."certificate_id" = ec."id"
         and sa."status" = 'signed'
        where dr."batch_id" = b."id"
      ) as "hasSignedCertificate",
      (
        exists (
          select 1
          from "document_results" dr
          inner join "extracted_certificates" ec
            on ec."document_result_id" = dr."id"
          inner join "certificate_merge_job_inputs" mi
            on mi."certificate_id" = ec."id"
          where dr."batch_id" = b."id"
        )
        or exists (
          select 1
          from "certificate_merge_job_batches" mb
          where mb."batch_id" = b."id"
        )
      ) as "hasMergeInput",
      exists (
        select 1
        from "intake_files" f
        where f."batch_id" = b."id"
          and f."purge_status" is not null
      ) as "hasFilePurge"
    from "intake_batches" b
    where b."id" in (${sql.join(
      batchIds.map((batchId) => sql`${batchId}::uuid`),
      sql`, `,
    )})
  `)
  const rows = (
    result as { rows?: Array<BatchProtectionWithIdRow> } | undefined
  )?.rows
  const protectionByBatchId = new Map(
    (rows ?? []).map((row) => [row.batchId, row]),
  )
  return new Map(
    batchIds.map((batchId) => [
      batchId,
      resolveBatchDeletionEligibility(protectionByBatchId.get(batchId)),
    ]),
  )
}

export const getBatchDeletionEligibility = async (batchId: string) =>
  (await getBatchDeletionEligibilityMap([batchId])).get(batchId) ??
  eligibleForDeletion()

const dispatchPurge = async (target: {
  targetType: 'batch' | 'upload'
  targetId: string
}) => {
  void target
  requireFeature('purge')
  throw new Error('No purge provider is configured.')
}

const markDispatchFailed = async (
  target: 'batch' | 'upload',
  targetId: string,
  error: unknown,
) => {
  const db = getDb()
  const now = new Date()
  const values = {
    purgeStatus: 'failed',
    purgeStartedAt: null,
    purgeError: sanitizePurgeError(error),
    updatedAt: now,
  } as const

  if (target === 'batch') {
    await db
      .update(intakeBatches)
      .set(values)
      .where(
        and(
          eq(intakeBatches.id, targetId),
          eq(intakeBatches.purgeStatus, 'queued'),
        ),
      )
    return
  }

  await db
    .update(intakeFiles)
    .set(values)
    .where(
      and(eq(intakeFiles.id, targetId), eq(intakeFiles.purgeStatus, 'queued')),
    )
}

type QueuePurgeResult =
  | {
      status: 'ok'
      targetId: string
      purgeStatus: PurgeStatus
      alreadyQueued: boolean
    }
  | { status: 'not_found' }
  | { status: 'invalid_state'; eligibility: DeletionEligibility }
  | { status: 'dispatch_failed'; error: string }

export const queueUploadPurge = async (input: {
  uploadId: string
  userId: string
}): Promise<QueuePurgeResult> => {
  requireFeature('purge')
  const db = getDb()
  const queued = await db.transaction(async (tx) => {
    const locked = await tx
      .select({ file: intakeFiles, batchDeletedAt: intakeBatches.deletedAt })
      .from(intakeFiles)
      .innerJoin(intakeBatches, eq(intakeBatches.id, intakeFiles.batchId))
      .where(eq(intakeFiles.id, input.uploadId))
      .limit(1)
      .for('update')
    const lockedRow = locked.at(0)
    if (!lockedRow) return { status: 'not_found' as const }
    const { file } = lockedRow

    if (file.purgeStatus === 'queued' || file.purgeStatus === 'running') {
      return {
        status: 'ok' as const,
        targetId: file.id,
        purgeStatus: file.purgeStatus as PurgeStatus,
        alreadyQueued: true,
      }
    }

    const resolvedEligibility =
      (await getUploadDeletionEligibilityMap([file])).get(file.id) ??
      eligibleForDeletion()
    if (lockedRow.batchDeletedAt || !resolvedEligibility.canDelete) {
      return {
        status: 'invalid_state' as const,
        eligibility: lockedRow.batchDeletedAt
          ? notEligible(
              'batch_deleted',
              'Restore the Recently Deleted batch or permanently delete the whole batch.',
            )
          : resolvedEligibility,
      }
    }

    const now = new Date()
    await tx
      .update(intakeFiles)
      .set({
        purgeStatus: 'queued',
        purgeRequestedAt: now,
        purgeRequestedByUserId: input.userId,
        purgeStartedAt: null,
        purgeError: null,
        updatedAt: now,
      })
      .where(eq(intakeFiles.id, file.id))

    return {
      status: 'ok' as const,
      targetId: file.id,
      purgeStatus: 'queued' as const,
      alreadyQueued: false,
    }
  })

  if (queued.status !== 'ok' || queued.alreadyQueued) return queued

  try {
    await dispatchPurge({ targetType: 'upload', targetId: queued.targetId })
    return queued
  } catch (error) {
    await markDispatchFailed('upload', queued.targetId, error)
    return { status: 'dispatch_failed', error: sanitizePurgeError(error) }
  }
}

export const queueBatchPurge = async (input: {
  batchId: string
  userId: string
}): Promise<QueuePurgeResult> => {
  requireFeature('purge')
  const db = getDb()
  const queued = await db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(intakeBatches)
      .where(eq(intakeBatches.id, input.batchId))
      .limit(1)
      .for('update')
    const batch = locked.at(0)
    if (!batch) return { status: 'not_found' as const }

    if (!batch.deletedAt) {
      return {
        status: 'invalid_state' as const,
        eligibility: notEligible(
          'batch_not_deleted',
          'Move the batch to Recently Deleted before permanently deleting it.',
        ),
      }
    }
    if (batch.purgeStatus === 'queued' || batch.purgeStatus === 'running') {
      return {
        status: 'ok' as const,
        targetId: batch.id,
        purgeStatus: batch.purgeStatus as PurgeStatus,
        alreadyQueued: true,
      }
    }

    const eligibility = await getBatchDeletionEligibility(batch.id)
    if (!eligibility.canDelete) {
      return { status: 'invalid_state' as const, eligibility }
    }

    const now = new Date()
    await tx
      .update(intakeBatches)
      .set({
        purgeAfterAt: now,
        purgeStatus: 'queued',
        purgeRequestedAt: now,
        purgeRequestedByUserId: input.userId,
        purgeStartedAt: null,
        purgeError: null,
        updatedAt: now,
      })
      .where(eq(intakeBatches.id, batch.id))

    return {
      status: 'ok' as const,
      targetId: batch.id,
      purgeStatus: 'queued' as const,
      alreadyQueued: false,
    }
  })

  if (queued.status !== 'ok' || queued.alreadyQueued) return queued

  try {
    await dispatchPurge({ targetType: 'batch', targetId: queued.targetId })
    return queued
  } catch (error) {
    await markDispatchFailed('batch', queued.targetId, error)
    return { status: 'dispatch_failed', error: sanitizePurgeError(error) }
  }
}
