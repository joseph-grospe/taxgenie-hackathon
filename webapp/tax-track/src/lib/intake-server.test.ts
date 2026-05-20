import { describe, expect, it } from 'vitest'

import type { intakeFiles } from '@/lib/schema'
import type { IntakeBatchView } from '@/lib/upload-intake-types'
import { buildBatchListResponse } from '@/lib/batch-list'
import {
  EMPTY_INTAKE_UPLOAD_FILE_MESSAGE,
  MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES,
  isPdfFileUpload,
  resolveOverallStatus,
  uploadCreateSchema,
} from '@/lib/intake-utils'
import { getBatchSigningState } from '@/lib/intake-server'

type IntakeFileRecord = typeof intakeFiles.$inferSelect

const buildIntakeFile = (
  overrides: Partial<IntakeFileRecord> = {},
): IntakeFileRecord => ({
  id: '9de4cd8e-6be8-4928-a2cb-e417654c8e15',
  batchId: '7de4cd8e-6be8-4928-a2cb-e417654c8e15',
  uploadedByUserId: 'user_123',
  originalFileName: 'sample.pdf',
  sanitizedFileName: 'sample.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  storageBucket: 'taxtrack-storage',
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
  removedFromBatchAt: null,
  removedFromBatchByUserId: null,
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

const buildBatchView = (
  overrides: Partial<IntakeBatchView> = {},
): IntakeBatchView => ({
  id: 'batch-a',
  name: 'April upload batch',
  filesMode: 'summary',
  entity: {
    id: 1,
    shortName: 'AESI',
    companyName: 'Aboitiz Energy Solutions, Inc.',
    tin: '123456789000',
  },
  createdByUserId: 'user-1',
  status: 'closed',
  overallStatus: 'Completed',
  canSignBatch: false,
  batchSigningStatus: 'signed',
  totalFiles: 2,
  openAttentionCount: 0,
  counts: {
    pending: 0,
    uploaded: 0,
    queued: 0,
    processing: 0,
    success: 2,
    duplicate: 0,
    error: 0,
  },
  lastActivityAt: '2026-04-20T10:00:00.000Z',
  closedAt: '2026-04-20T10:00:00.000Z',
  createdAt: '2026-04-20T09:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
  files: [],
  ...overrides,
})

describe('intake-server', () => {
  it('rejects a missing upload file at the schema layer', () => {
    const parsed = uploadCreateSchema.safeParse({})

    expect(parsed.success).toBe(false)
  })

  it('accepts multi-file batch uploads at the schema layer', () => {
    const parsed = uploadCreateSchema.safeParse({
      entityId: 1,
      files: [
        {
          name: 'certificate-a.pdf',
          type: 'application/pdf',
          size: 2048,
        },
        {
          name: 'certificate-b.pdf',
          type: 'application/pdf',
          size: 4096,
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects empty intake PDFs with a clear schema message', () => {
    const parsed = uploadCreateSchema.safeParse({
      entityId: 1,
      files: [
        {
          name: 'certificate-empty.pdf',
          type: 'application/pdf',
          size: 0,
        },
      ],
    })

    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        EMPTY_INTAKE_UPLOAD_FILE_MESSAGE,
      )
    }
  })

  it('accepts non-empty intake PDFs below the file size limit', () => {
    const parsed = uploadCreateSchema.safeParse({
      entityId: 1,
      files: [
        {
          name: 'certificate-small.pdf',
          type: 'application/pdf',
          size: 1,
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  it('accepts intake PDFs exactly at the file size limit', () => {
    const parsed = uploadCreateSchema.safeParse({
      entityId: 1,
      files: [
        {
          name: 'certificate-limit.pdf',
          type: 'application/pdf',
          size: MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES,
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects intake PDFs over the file size limit', () => {
    const parsed = uploadCreateSchema.safeParse({
      entityId: 1,
      files: [
        {
          name: 'certificate-too-large.pdf',
          type: 'application/pdf',
          size: MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES + 1,
        },
      ],
    })

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

  it('requires all ready certificates to be reconciled before batch signing', () => {
    const batch = { id: 'batch-1', status: 'closed' as const }
    const counts = {
      pending: 0,
      uploaded: 0,
      queued: 0,
      processing: 0,
      success: 2,
      duplicate: 0,
      error: 0,
    }
    const signingStatusByBatchId = new Map([
      ['batch-1', { certificateCount: 2, signedCount: 0 }],
    ])

    expect(
      getBatchSigningState({
        batch,
        counts,
        signingStatusByBatchId,
        reconciliationStatusByBatchId: new Map([
          ['batch-1', { reconciledCount: 1 }],
        ]),
      }),
    ).toEqual({
      canSignBatch: false,
      batchSigningStatus: 'unavailable',
    })

    expect(
      getBatchSigningState({
        batch,
        counts,
        signingStatusByBatchId,
        reconciliationStatusByBatchId: new Map([
          ['batch-1', { reconciledCount: 2 }],
        ]),
      }),
    ).toEqual({
      canSignBatch: true,
      batchSigningStatus: 'unsigned',
    })
  })

  it('builds lightweight batch list rows with table-wide search', () => {
    const result = buildBatchListResponse(
      [
        buildBatchView({
          id: 'batch-a',
          name: 'April withholding',
          createdByUserId: 'user-1',
        }),
        buildBatchView({
          id: 'batch-b',
          name: 'May upload',
          createdByUserId: 'user-2',
          entity: {
            id: 2,
            shortName: 'BKS',
            companyName: 'Bukidnon Sugar Milling Co.',
            tin: '987654321000',
          },
        }),
      ],
      {
        q: 'bukidnon',
        status: 'all',
        entity: '',
        signingStatus: 'all',
        attention: 'all',
        page: 1,
        pageSize: 25,
        ownersByUserId: new Map([
          ['user-1', { name: 'Ada Admin', email: 'ada@example.com' }],
          ['user-2', { name: 'Eli Editor', email: 'eli@example.com' }],
        ]),
      },
    )

    expect(result.batches).toHaveLength(1)
    expect(result.batches[0]).toEqual(
      expect.objectContaining({
        id: 'batch-b',
        entityName: 'BKS',
        ownerName: 'Eli Editor',
      }),
    )
    expect(result.batches[0]).not.toHaveProperty('files')
  })

  it('filters batch list rows by status, entity, signing, attention, and pagination', () => {
    const result = buildBatchListResponse(
      [
        buildBatchView({
          id: 'batch-a',
          overallStatus: 'Active',
          status: 'open',
          batchSigningStatus: 'unavailable',
        }),
        buildBatchView({
          id: 'batch-b',
          name: 'Review batch',
          overallStatus: 'Needs Review',
          batchSigningStatus: 'partial',
          openAttentionCount: 2,
          entity: {
            id: 2,
            shortName: 'BKS',
            companyName: 'Bukidnon Sugar Milling Co.',
            tin: '987654321000',
          },
        }),
        buildBatchView({
          id: 'batch-c',
          overallStatus: 'Needs Review',
          batchSigningStatus: 'partial',
          openAttentionCount: 1,
          entity: {
            id: 2,
            shortName: 'BKS',
            companyName: 'Bukidnon Sugar Milling Co.',
            tin: '987654321000',
          },
        }),
      ],
      {
        q: '',
        status: 'Needs Review',
        entity: 'BKS',
        signingStatus: 'partial',
        attention: 'needs_attention',
        page: 2,
        pageSize: 1,
      },
    )

    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    })
    expect(result.summary).toEqual({
      total: 2,
      active: 0,
      needsReview: 2,
      completed: 0,
    })
    expect(result.batches.map((batch) => batch.id)).toEqual(['batch-c'])
    expect(result.filterOptions.signingStatuses).toEqual([
      'unavailable',
      'partial',
    ])
  })
})
