import { randomUUID } from 'node:crypto'

import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { QueueMessageSchema } from '@taxtrack/shared'
import { and, desc, eq } from 'drizzle-orm'
import type { HeadObjectCommandOutput, S3Client } from '@aws-sdk/client-s3'
import type { SQSClient, SendMessageCommandOutput } from '@aws-sdk/client-sqs'

import {
  createS3ServerClient,
  createSqsServerClient,
  getQueueUrl,
} from '@/lib/aws-server'
import { getDb } from '@/lib/db'
import {
  buildExtractionRetryView,
  buildManualExtractionRetryRevision,
} from '@/lib/extraction-retry'
import {
  documentExtractionAttempts,
  documentResults,
  intakeBatches,
  intakeFiles,
} from '@/lib/schema'

type IntakeFileRecord = typeof intakeFiles.$inferSelect
type IntakeBatchRecord = typeof intakeBatches.$inferSelect
type DocumentResultRecord = typeof documentResults.$inferSelect
type ExtractionAttemptRecord = typeof documentExtractionAttempts.$inferSelect

type RetryContext = {
  file: IntakeFileRecord
  batch: IntakeBatchRecord
  results: Array<DocumentResultRecord>
  extractionAttempts: Array<ExtractionAttemptRecord>
}

type RetryFileSnapshot = Pick<
  IntakeFileRecord,
  | 'uploadStatus'
  | 'queueStatus'
  | 'processingStatus'
  | 'revision'
  | 'eventId'
  | 'traceId'
  | 'queueMessageId'
  | 'artifactUri'
  | 'currentPhase'
  | 'currentStep'
  | 'errorMessage'
  | 'queuedAt'
  | 'processingStartedAt'
  | 'processingFinishedAt'
>

type RetryReservation = {
  file: IntakeFileRecord
  batch: IntakeBatchRecord
  previous: RetryFileSnapshot
  retryNumber: number
  revision: string
  eventId: string
  traceId: string
  artifactUri: string
  reservedAt: Date
  reasonCodes: Array<string>
}

export type RetryExtractionResult = {
  uploadId: string
  sourceDocumentResultId: number
  sourceExtractionAttemptId: number
  reasonCodes: Array<string>
  retryNumber: number
  revision: string
  eventId: string
  status: 'queued'
}

type RetryPersistence = {
  load: (uploadId: string) => Promise<RetryContext | null>
  reserve: (input: {
    uploadId: string
    sourceDocumentResultId: number
    sourceExtractionAttemptId: number
    now: Date
    identifier: string
  }) => Promise<RetryReservation>
  markQueued: (input: {
    reservation: RetryReservation
    messageId: string | null
    queuedAt: Date
  }) => Promise<void>
  rollback: (input: {
    reservation: RetryReservation
    rolledBackAt: Date
  }) => Promise<void>
}

export type RetryExtractionServiceDeps = {
  persistence: RetryPersistence
  headObject: (input: {
    bucket: string
    key: string
  }) => Promise<HeadObjectCommandOutput>
  sendMessage: (input: {
    queueUrl: string
    body: string
  }) => Promise<SendMessageCommandOutput>
  queueUrl: string
  now?: () => Date
  createIdentifier?: () => string
}

export class ExtractionRetryError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 502,
  ) {
    super(message)
    this.name = 'ExtractionRetryError'
  }
}

const toSelectedEntity = (batch: IntakeBatchRecord) => {
  const tin = batch.entityTin?.trim()
  if (!batch.entityId || !tin || tin.replace(/\D/g, '').length < 9) {
    throw new ExtractionRetryError(
      'The upload batch does not have a valid selected entity.',
      409,
    )
  }

  return {
    id: batch.entityId,
    shortName: batch.entityShortName,
    companyName: batch.entityCompanyName,
    tin,
  }
}

const toLatestResult = (context: RetryContext) => context.results.at(0)

const toRetryConflictMessage = (
  disabledReason: NonNullable<
    ReturnType<typeof buildExtractionRetryView>
  >['disabledReason'],
) => {
  switch (disabledReason) {
    case 'already_processing':
      return 'This document is already queued or processing.'
    case 'limit_reached':
      return 'This document has reached the maximum of three extraction retries.'
    case 'cooldown':
      return 'Wait 60 seconds after the latest failure before retrying.'
    default:
      return 'This document cannot be retried.'
  }
}

const requireRetryCapability = (
  context: RetryContext,
  sourceDocumentResultId: number,
  sourceExtractionAttemptId: number,
  now: Date,
) => {
  const latestResult = toLatestResult(context)
  if (!latestResult) {
    throw new ExtractionRetryError('Document result not found.', 404)
  }
  if (latestResult.id !== sourceDocumentResultId) {
    throw new ExtractionRetryError(
      'The document result changed. Refresh before retrying.',
      409,
    )
  }
  if (latestResult.currentExtractionAttemptId !== sourceExtractionAttemptId) {
    throw new ExtractionRetryError(
      'The extraction attempt changed. Refresh before retrying.',
      409,
    )
  }

  const retry = buildExtractionRetryView({
    latestResult,
    extractionAttempts: context.extractionAttempts,
    file: context.file,
    now,
  })
  if (!retry) {
    throw new ExtractionRetryError(
      'Only transient Gemini provider failures can be retried.',
      409,
    )
  }
  if (!retry.canRetry) {
    throw new ExtractionRetryError(
      toRetryConflictMessage(retry.disabledReason),
      409,
    )
  }

  return retry
}

const createRetryPersistence = (): RetryPersistence => {
  const db = getDb()

  const load = async (uploadId: string): Promise<RetryContext | null> => {
    const fileRows = await db
      .select()
      .from(intakeFiles)
      .where(eq(intakeFiles.id, uploadId))
      .limit(1)
    const file = fileRows.at(0)
    if (!file) {
      return null
    }

    const [batchRows, results, extractionAttempts] = await Promise.all([
      db
        .select()
        .from(intakeBatches)
        .where(eq(intakeBatches.id, file.batchId))
        .limit(1),
      db
        .select()
        .from(documentResults)
        .where(eq(documentResults.uploadId, uploadId))
        .orderBy(desc(documentResults.createdAt), desc(documentResults.id)),
      db
        .select()
        .from(documentExtractionAttempts)
        .where(eq(documentExtractionAttempts.uploadId, uploadId))
        .orderBy(desc(documentExtractionAttempts.startedAt)),
    ])
    const batch = batchRows.at(0)
    return batch ? { file, batch, results, extractionAttempts } : null
  }

  return {
    load,
    reserve: async (input) =>
      db.transaction(async (tx) => {
        const fileRows = await tx
          .select()
          .from(intakeFiles)
          .where(eq(intakeFiles.id, input.uploadId))
          .for('update')
          .limit(1)
        const file = fileRows.at(0)
        if (!file) {
          throw new ExtractionRetryError('Upload record not found.', 404)
        }

        const [batchRows, results, extractionAttempts] = await Promise.all([
          tx
            .select()
            .from(intakeBatches)
            .where(eq(intakeBatches.id, file.batchId))
            .limit(1),
          tx
            .select()
            .from(documentResults)
            .where(eq(documentResults.uploadId, input.uploadId))
            .orderBy(desc(documentResults.createdAt), desc(documentResults.id)),
          tx
            .select()
            .from(documentExtractionAttempts)
            .where(eq(documentExtractionAttempts.uploadId, input.uploadId))
            .orderBy(desc(documentExtractionAttempts.startedAt)),
        ])
        const batch = batchRows.at(0)
        if (!batch) {
          throw new ExtractionRetryError('Upload batch not found.', 404)
        }
        if (batch.deletedAt) {
          throw new ExtractionRetryError(
            'Deleted upload batches cannot be retried.',
            409,
          )
        }
        if (file.removedFromBatchAt) {
          throw new ExtractionRetryError(
            'Removed uploads cannot be retried.',
            409,
          )
        }
        if (file.purgeStatus) {
          throw new ExtractionRetryError(
            'Uploads queued for permanent deletion cannot be retried.',
            409,
          )
        }

        const context = { file, batch, results, extractionAttempts }
        const retry = requireRetryCapability(
          context,
          input.sourceDocumentResultId,
          input.sourceExtractionAttemptId,
          input.now,
        )
        const retryNumber = retry.retryCount + 1
        const revision = buildManualExtractionRetryRevision(
          retryNumber,
          input.identifier,
        )
        const eventId = `${file.id}:${revision}`
        const traceId = file.traceId?.trim() || randomUUID()
        const artifactUri = `s3://${file.storageBucket}/${file.storageKey}`
        const previous: RetryFileSnapshot = {
          uploadStatus: file.uploadStatus,
          queueStatus: file.queueStatus,
          processingStatus: file.processingStatus,
          revision: file.revision,
          eventId: file.eventId,
          traceId: file.traceId,
          queueMessageId: file.queueMessageId,
          artifactUri: file.artifactUri,
          currentPhase: file.currentPhase,
          currentStep: file.currentStep,
          errorMessage: file.errorMessage,
          queuedAt: file.queuedAt,
          processingStartedAt: file.processingStartedAt,
          processingFinishedAt: file.processingFinishedAt,
        }

        await tx
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
            queueMessageId: null,
            currentPhase: 'extract',
            currentStep: 'retry_queueing',
            errorMessage: null,
            queuedAt: null,
            processingStartedAt: null,
            processingFinishedAt: null,
            updatedAt: input.now,
          })
          .where(eq(intakeFiles.id, file.id))

        await tx
          .update(intakeBatches)
          .set({
            lastActivityAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(intakeBatches.id, batch.id))

        return {
          file,
          batch,
          previous,
          retryNumber,
          revision,
          eventId,
          traceId,
          artifactUri,
          reservedAt: input.now,
          reasonCodes: retry.reasonCodes,
        }
      }),
    markQueued: async ({ reservation, messageId, queuedAt }) => {
      await db
        .update(intakeFiles)
        .set({
          queueStatus: 'queued',
          queueMessageId: messageId,
          currentPhase: 'extract',
          currentStep: 'queued',
          queuedAt,
          errorMessage: null,
          updatedAt: queuedAt,
        })
        .where(
          and(
            eq(intakeFiles.id, reservation.file.id),
            eq(intakeFiles.eventId, reservation.eventId),
          ),
        )

      await db
        .update(intakeBatches)
        .set({
          lastActivityAt: queuedAt,
          updatedAt: queuedAt,
        })
        .where(eq(intakeBatches.id, reservation.batch.id))
    },
    rollback: async ({ reservation, rolledBackAt }) => {
      await db
        .update(intakeFiles)
        .set({
          ...reservation.previous,
          updatedAt: rolledBackAt,
        })
        .where(
          and(
            eq(intakeFiles.id, reservation.file.id),
            eq(intakeFiles.eventId, reservation.eventId),
          ),
        )
    },
  }
}

const createDefaultRetryExtractionServiceDeps =
  (): RetryExtractionServiceDeps => {
    const s3: Pick<S3Client, 'send'> = createS3ServerClient()
    const sqs: Pick<SQSClient, 'send'> = createSqsServerClient()

    return {
      persistence: createRetryPersistence(),
      headObject: (input) =>
        s3.send(
          new HeadObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
          }),
        ),
      sendMessage: (input) =>
        sqs.send(
          new SendMessageCommand({
            QueueUrl: input.queueUrl,
            MessageBody: input.body,
          }),
        ),
      queueUrl: getQueueUrl(),
    }
  }

export const createRetryDocumentExtraction = (
  deps: RetryExtractionServiceDeps,
) => {
  const now = deps.now ?? (() => new Date())
  const createIdentifier = deps.createIdentifier ?? randomUUID

  return async (input: {
    uploadId: string
    sourceDocumentResultId: number
    sourceExtractionAttemptId: number
  }): Promise<RetryExtractionResult> => {
    const context = await deps.persistence.load(input.uploadId)
    if (!context) {
      throw new ExtractionRetryError('Upload record not found.', 404)
    }
    if (context.batch.deletedAt) {
      throw new ExtractionRetryError(
        'Deleted upload batches cannot be retried.',
        409,
      )
    }
    if (context.file.removedFromBatchAt) {
      throw new ExtractionRetryError('Removed uploads cannot be retried.', 409)
    }
    if (context.file.purgeStatus) {
      throw new ExtractionRetryError(
        'Uploads queued for permanent deletion cannot be retried.',
        409,
      )
    }
    requireRetryCapability(
      context,
      input.sourceDocumentResultId,
      input.sourceExtractionAttemptId,
      now(),
    )
    toSelectedEntity(context.batch)

    let head: HeadObjectCommandOutput
    try {
      head = await deps.headObject({
        bucket: context.file.storageBucket,
        key: context.file.storageKey,
      })
    } catch {
      throw new ExtractionRetryError(
        'The original PDF is unavailable and cannot be retried.',
        409,
      )
    }

    const contentType = head.ContentType?.trim() || context.file.mimeType
    const contentLength = Number(head.ContentLength ?? 0)
    if (!contentType.toLowerCase().includes('pdf')) {
      throw new ExtractionRetryError(
        'The original source is no longer a PDF.',
        409,
      )
    }
    if (contentLength !== context.file.sizeBytes) {
      throw new ExtractionRetryError(
        'The original PDF size no longer matches the upload record.',
        409,
      )
    }

    const reservedAt = now()
    const reservation = await deps.persistence.reserve({
      uploadId: input.uploadId,
      sourceDocumentResultId: input.sourceDocumentResultId,
      sourceExtractionAttemptId: input.sourceExtractionAttemptId,
      now: reservedAt,
      identifier: createIdentifier(),
    })
    const selectedEntity = toSelectedEntity(reservation.batch)
    const payload = QueueMessageSchema.parse({
      event: {
        version: 'v1',
        eventId: reservation.eventId,
        traceId: reservation.traceId,
        source: 'manual-upload',
        batchId: reservation.file.batchId,
        uploadId: reservation.file.id,
        sourceFileId: reservation.file.id,
        revision: reservation.revision,
        originalFileName: reservation.file.originalFileName,
        modifiedTime: reservedAt.toISOString(),
        mimeType: contentType,
        sizeBytes: reservation.file.sizeBytes,
        artifactUri: reservation.artifactUri,
        selectedEntity,
        uploadedByUserId: reservation.file.uploadedByUserId,
        uploadedAt: (
          reservation.file.uploadedAt ?? reservation.file.createdAt
        ).toISOString(),
        receivedAt: reservedAt.toISOString(),
      },
    })

    let response: SendMessageCommandOutput
    try {
      response = await deps.sendMessage({
        queueUrl: deps.queueUrl,
        body: JSON.stringify(payload),
      })
    } catch {
      await deps.persistence.rollback({
        reservation,
        rolledBackAt: now(),
      })
      throw new ExtractionRetryError(
        'Unable to queue the extraction retry.',
        502,
      )
    }

    await deps.persistence.markQueued({
      reservation,
      messageId: response.MessageId ?? null,
      queuedAt: now(),
    })

    return {
      uploadId: reservation.file.id,
      sourceDocumentResultId: input.sourceDocumentResultId,
      sourceExtractionAttemptId: input.sourceExtractionAttemptId,
      reasonCodes: reservation.reasonCodes,
      retryNumber: reservation.retryNumber,
      revision: reservation.revision,
      eventId: reservation.eventId,
      status: 'queued',
    }
  }
}

export const retryDocumentExtraction = async (input: {
  uploadId: string
  sourceDocumentResultId: number
  sourceExtractionAttemptId: number
}) =>
  createRetryDocumentExtraction(createDefaultRetryExtractionServiceDeps())(
    input,
  )
