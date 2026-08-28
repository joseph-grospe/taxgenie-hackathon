import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RetryExtractionServiceDeps } from '@/lib/extraction-retry-server'
import {
  ExtractionRetryError,
  createRetryDocumentExtraction,
} from '@/lib/extraction-retry-server'

const now = new Date('2026-07-27T07:02:00.000Z')
const sourceCreatedAt = new Date('2026-07-27T06:59:00.000Z')

const file = {
  id: 'cf5f95d5-b974-407f-b05f-bdc62e7e0e5b',
  batchId: '11111111-1111-4111-8111-111111111111',
  uploadedByUserId: 'user-1',
  originalFileName: 'bir-2307.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  storageBucket: 'taxgenie-local',
  storageKey: 'uploads/cf5f95d5/source.pdf',
  queueStatus: 'queued',
  processingStatus: 'error',
  revision: 'etag-original',
  traceId: 'trace-original',
  uploadedAt: sourceCreatedAt,
  createdAt: sourceCreatedAt,
  removedFromBatchAt: null,
}

const batch = {
  id: file.batchId,
  entityId: 7,
  entityShortName: 'EAUC',
  entityCompanyName: 'East Asia Utilities Corporation',
  entityTin: '004760842000',
  deletedAt: null,
}

const failedResult = {
  id: 38,
  currentExtractionAttemptId: 104,
  uploadId: file.id,
  status: 'error',
  payload: null,
  certificateCount: 0,
  reasonCodes: ['gemini_http_503'],
  revision: 'etag-original',
  createdAt: sourceCreatedAt,
}

const failedAttempt = {
  id: 104,
  uploadId: file.id,
  retryNumber: 0,
  status: 'failed',
  startedAt: sourceCreatedAt,
  finishedAt: sourceCreatedAt,
}

const createHarness = () => {
  const reservation = {
    file,
    batch,
    previous: {},
    retryNumber: 1,
    revision: 'manual-retry-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    eventId:
      'cf5f95d5-b974-407f-b05f-bdc62e7e0e5b:manual-retry-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    traceId: 'trace-original',
    artifactUri: `s3://${file.storageBucket}/${file.storageKey}`,
    reservedAt: now,
    reasonCodes: ['gemini_http_503'],
  }
  const persistence = {
    load: vi.fn().mockResolvedValue({
      file,
      batch,
      results: [failedResult],
      extractionAttempts: [failedAttempt],
    }),
    reserve: vi.fn().mockResolvedValue(reservation),
    markQueued: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  }
  const headObject = vi.fn().mockResolvedValue({
    ContentType: 'application/pdf',
    ContentLength: file.sizeBytes,
    ETag: '"etag-original"',
    $metadata: {},
  })
  const sendMessage = vi.fn().mockResolvedValue({
    MessageId: 'sqs-message-1',
    $metadata: {},
  })
  const deps = {
    persistence,
    headObject,
    sendMessage,
    queueUrl: 'https://sqs.example.test/queue',
    now: () => now,
    createIdentifier: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  } as unknown as RetryExtractionServiceDeps

  return {
    retry: createRetryDocumentExtraction(deps),
    persistence,
    headObject,
    sendMessage,
    reservation,
  }
}

describe('retryDocumentExtraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queues the same immutable PDF under a fresh revision and event ID', async () => {
    const harness = createHarness()

    const result = await harness.retry({
      uploadId: file.id,
      sourceDocumentResultId: failedResult.id,
      sourceExtractionAttemptId: failedAttempt.id,
    })

    expect(harness.headObject).toHaveBeenCalledWith({
      bucket: file.storageBucket,
      key: file.storageKey,
    })
    expect(harness.persistence.reserve).toHaveBeenCalledWith({
      uploadId: file.id,
      sourceDocumentResultId: failedResult.id,
      sourceExtractionAttemptId: failedAttempt.id,
      now,
      identifier: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    })
    const message = JSON.parse(
      harness.sendMessage.mock.calls[0]?.[0]?.body as string,
    )
    expect(message.event).toMatchObject({
      uploadId: file.id,
      sourceFileId: file.id,
      revision: harness.reservation.revision,
      eventId: harness.reservation.eventId,
      artifactUri: `s3://${file.storageBucket}/${file.storageKey}`,
      sizeBytes: file.sizeBytes,
    })
    expect(result).toMatchObject({
      uploadId: file.id,
      retryNumber: 1,
      revision: harness.reservation.revision,
      status: 'queued',
      reasonCodes: ['gemini_http_503'],
    })
    expect(harness.persistence.markQueued).toHaveBeenCalledWith({
      reservation: harness.reservation,
      messageId: 'sqs-message-1',
      queuedAt: now,
    })
  })

  it('rolls back only through the reserved retry when SQS send fails', async () => {
    const harness = createHarness()
    harness.sendMessage.mockRejectedValueOnce(new Error('SQS unavailable'))

    await expect(
      harness.retry({
        uploadId: file.id,
        sourceDocumentResultId: failedResult.id,
        sourceExtractionAttemptId: failedAttempt.id,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ExtractionRetryError>>({
        status: 502,
        message: 'Unable to queue the extraction retry.',
      }),
    )
    expect(harness.persistence.rollback).toHaveBeenCalledWith({
      reservation: harness.reservation,
      rolledBackAt: now,
    })
    expect(harness.persistence.markQueued).not.toHaveBeenCalled()
  })

  it('rejects a stale source result before touching S3 or SQS', async () => {
    const harness = createHarness()

    await expect(
      harness.retry({
        uploadId: file.id,
        sourceDocumentResultId: 37,
        sourceExtractionAttemptId: failedAttempt.id,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'The document result changed. Refresh before retrying.',
    })
    expect(harness.headObject).not.toHaveBeenCalled()
    expect(harness.sendMessage).not.toHaveBeenCalled()
  })

  it('rejects a stale extraction attempt even when the result id is stable', async () => {
    const harness = createHarness()

    await expect(
      harness.retry({
        uploadId: file.id,
        sourceDocumentResultId: failedResult.id,
        sourceExtractionAttemptId: failedAttempt.id - 1,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'The extraction attempt changed. Refresh before retrying.',
    })
    expect(harness.headObject).not.toHaveBeenCalled()
    expect(harness.sendMessage).not.toHaveBeenCalled()
  })

  it('rejects an active upload before queueing a duplicate message', async () => {
    const harness = createHarness()
    harness.persistence.load.mockResolvedValueOnce({
      file: { ...file, processingStatus: 'pending' },
      batch,
      results: [failedResult],
      extractionAttempts: [failedAttempt],
    })

    await expect(
      harness.retry({
        uploadId: file.id,
        sourceDocumentResultId: failedResult.id,
        sourceExtractionAttemptId: failedAttempt.id,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'This document is already queued or processing.',
    })
    expect(harness.headObject).not.toHaveBeenCalled()
  })

  it('honors the locked revalidation when two submissions race', async () => {
    const harness = createHarness()
    harness.persistence.reserve.mockRejectedValueOnce(
      new ExtractionRetryError(
        'This document is already queued or processing.',
        409,
      ),
    )

    await expect(
      harness.retry({
        uploadId: file.id,
        sourceDocumentResultId: failedResult.id,
        sourceExtractionAttemptId: failedAttempt.id,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'This document is already queued or processing.',
    })
    expect(harness.headObject).toHaveBeenCalledTimes(1)
    expect(harness.sendMessage).not.toHaveBeenCalled()
  })

  it.each([
    {
      head: {
        ContentType: 'application/octet-stream',
        ContentLength: file.sizeBytes,
      },
      message: 'The original source is no longer a PDF.',
    },
    {
      head: {
        ContentType: 'application/pdf',
        ContentLength: file.sizeBytes + 1,
      },
      message: 'The original PDF size no longer matches the upload record.',
    },
  ])('rejects source metadata mismatches', async ({ head, message }) => {
    const harness = createHarness()
    harness.headObject.mockResolvedValueOnce({ ...head, $metadata: {} })

    await expect(
      harness.retry({
        uploadId: file.id,
        sourceDocumentResultId: failedResult.id,
        sourceExtractionAttemptId: failedAttempt.id,
      }),
    ).rejects.toMatchObject({ status: 409, message })
    expect(harness.persistence.reserve).not.toHaveBeenCalled()
    expect(harness.sendMessage).not.toHaveBeenCalled()
  })

  it('returns a controlled conflict when the original PDF is missing', async () => {
    const harness = createHarness()
    harness.headObject.mockRejectedValueOnce(new Error('NoSuchKey'))

    await expect(
      harness.retry({
        uploadId: file.id,
        sourceDocumentResultId: failedResult.id,
        sourceExtractionAttemptId: failedAttempt.id,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'The original PDF is unavailable and cannot be retried.',
    })
    expect(harness.persistence.reserve).not.toHaveBeenCalled()
  })
})
