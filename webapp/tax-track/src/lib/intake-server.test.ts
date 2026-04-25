import { describe, expect, it } from 'vitest'

import type { intakeFiles } from '@/lib/schema'
import {
  isPdfFileUpload,
  resolveOverallStatus,
  uploadCreateSchema,
} from '@/lib/intake-utils'

type IntakeFileRecord = typeof intakeFiles.$inferSelect

const buildIntakeFile = (
  overrides: Partial<IntakeFileRecord> = {},
): IntakeFileRecord => ({
  id: '9de4cd8e-6be8-4928-a2cb-e417654c8e15',
  uploadedByUserId: 'user_123',
  originalFileName: 'sample.pdf',
  sanitizedFileName: 'sample.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  storageBucket: 'taxtrack-source-files',
  storageKey: 'uploads/9de4cd8e-6be8-4928-a2cb-e417654c8e15/sample.pdf',
  artifactUri: null,
  sourceFileId: null,
  revision: null,
  eventId: null,
  traceId: null,
  queueMessageId: null,
  certificateDocumentType: null,
  certificateIssuerShortName: null,
  certificateIssuerShortNameNormalized: null,
  certificateRecipientShortName: null,
  certificateSettlementReferenceNumber: null,
  certificateBillingMonthMMYY: null,
  certificateDateUploaded: null,
  uploadStatus: 'pending',
  queueStatus: 'pending',
  processingStatus: 'pending',
  attentionStatus: 'open',
  attentionResolvedAt: null,
  attentionResolvedByUserId: null,
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
  it('rejects a missing upload file at the schema layer', () => {
    const parsed = uploadCreateSchema.safeParse({})

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

  it('derives queued and processing upload states without batch aggregation', () => {
    expect(
      resolveOverallStatus(
        buildIntakeFile({
          uploadStatus: 'uploaded',
          queueStatus: 'queued',
          processingStatus: 'pending',
        }),
      ),
    ).toBe('queued')

    expect(
      resolveOverallStatus(
        buildIntakeFile({
          uploadStatus: 'uploaded',
          queueStatus: 'queued',
          processingStatus: 'processing',
        }),
      ),
    ).toBe('processing')
  })
})
