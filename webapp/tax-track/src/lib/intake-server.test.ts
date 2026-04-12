import { describe, expect, it } from 'vitest'

import {
  deriveBatchStatus,
  isPdfFileUpload,
  uploadBatchCreateSchema,
} from '@/lib/intake-utils'
import { intakeFiles } from '@/lib/schema'

type IntakeFileRecord = typeof intakeFiles.$inferSelect

const buildIntakeFile = (
  overrides: Partial<IntakeFileRecord> = {},
): IntakeFileRecord => ({
  id: '9de4cd8e-6be8-4928-a2cb-e417654c8e15',
  batchId: 'ca89f4af-c492-418f-b243-18d1615af8c6',
  uploadedByUserId: 'user_123',
  originalFileName: 'sample.pdf',
  sanitizedFileName: 'sample.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  storageBucket: 'taxtrack-source-files',
  storageKey: 'uploads/batch/upload/sample.pdf',
  artifactUri: null,
  sourceFileId: null,
  revision: null,
  eventId: null,
  traceId: null,
  queueMessageId: null,
  uploadStatus: 'pending',
  queueStatus: 'pending',
  processingStatus: 'pending',
  currentPhase: null,
  currentStep: null,
  errorMessage: null,
  uploadedAt: null,
  queuedAt: null,
  processingStartedAt: null,
  processingFinishedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
})

describe('intake-server', () => {
  it('rejects empty upload batches at the schema layer', () => {
    const parsed = uploadBatchCreateSchema.safeParse({ files: [] })

    expect(parsed.success).toBe(false)
  })

  it('accepts only pdf uploads for the intake flow', () => {
    expect(
      isPdfFileUpload({
        name: 'certificate.pdf',
        type: 'application/pdf',
      }),
    ).toBe(true)

    expect(
      isPdfFileUpload({
        name: 'notes.txt',
        type: 'text/plain',
      }),
    ).toBe(false)
  })

  it('reports processing while any file is still running', () => {
    const status = deriveBatchStatus([
      buildIntakeFile({
        uploadStatus: 'uploaded',
        queueStatus: 'queued',
        processingStatus: 'processing',
      }),
      buildIntakeFile({
        id: 'd7aefc80-5884-41f0-bf2f-75450ea259be',
        uploadStatus: 'uploaded',
        queueStatus: 'queued',
        processingStatus: 'pending',
      }),
    ])

    expect(status).toBe('processing')
  })

  it('reports completed when every file finished without an error', () => {
    const status = deriveBatchStatus([
      buildIntakeFile({
        uploadStatus: 'uploaded',
        queueStatus: 'queued',
        processingStatus: 'success',
      }),
      buildIntakeFile({
        id: 'd7aefc80-5884-41f0-bf2f-75450ea259be',
        uploadStatus: 'uploaded',
        queueStatus: 'queued',
        processingStatus: 'duplicate',
      }),
    ])

    expect(status).toBe('completed')
  })

  it('reports completed_with_errors when any file ends in an error', () => {
    const status = deriveBatchStatus([
      buildIntakeFile({
        uploadStatus: 'uploaded',
        queueStatus: 'queued',
        processingStatus: 'success',
      }),
      buildIntakeFile({
        id: 'd7aefc80-5884-41f0-bf2f-75450ea259be',
        uploadStatus: 'uploaded',
        queueStatus: 'failed',
        processingStatus: 'error',
      }),
    ])

    expect(status).toBe('completed_with_errors')
  })
})
