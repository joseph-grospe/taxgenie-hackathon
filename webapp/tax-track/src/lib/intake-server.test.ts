import { describe, expect, it } from 'vitest'

import type { intakeFiles } from '@/lib/schema'
import type { IntakeBatchView } from '@/lib/upload-intake-types'
import { buildBatchListResponse } from '@/lib/batch-list'
import {
  EMPTY_INTAKE_UPLOAD_FILE_MESSAGE,
  MAX_INTAKE_UPLOAD_FILE_SIZE_BYTES,
  hasUnprocessedUploads,
  isPdfFileUpload,
  resolveOverallStatus,
  uploadCreateSchema,
} from '@/lib/intake-utils'
import {
  buildDefaultUploadBatchName,
  getBatchSigningState,
} from '@/lib/intake-server'

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
  deletedAt: null,
  deletedByUserId: null,
  purgeAfterAt: null,
  createdAt: '2026-04-20T09:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
  files: [],
  ...overrides,
})

describe('intake-server', () => {
  it('builds default upload batch names from entity short name and Manila creation date', () => {
    expect(
      buildDefaultUploadBatchName({
        entity: {
          id: 1,
          shortName: 'AESI',
          companyName: 'Aboitiz Energy Solutions, Inc.',
          tin: '123456789000',
        },
        createdAt: new Date('2026-05-31T16:00:00.000Z'),
      }),
    ).toBe('AESI - Jun 01, 2026')
  })

  it('falls back when building default upload batch names without a short name', () => {
    expect(
      buildDefaultUploadBatchName({
        entity: {
          id: 2,
          shortName: null,
          companyName: 'Bukidnon Sugar Milling Co.',
          tin: '987654321000',
        },
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).toBe('Bukidnon Sugar Milling Co. - Jun 01, 2026')

    expect(
      buildDefaultUploadBatchName({
        entity: {
          id: 3,
          shortName: null,
          companyName: null,
          tin: '111222333000',
        },
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).toBe('111222333000 - Jun 01, 2026')
  })

  it('keeps generated default upload batch names within the rename limit', () => {
    const name = buildDefaultUploadBatchName({
      entity: {
        id: 4,
        shortName:
          'Very Long Entity Name That Would Otherwise Exceed The Upload Batch Rename Limit',
        companyName: null,
        tin: '123456789000',
      },
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    })

    expect(name).toHaveLength(80)
    expect(name.endsWith(' - Jun 01, 2026')).toBe(true)
  })

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

  it('treats pending, uploaded, queued, and processing uploads as unprocessed', () => {
    expect(
      hasUnprocessedUploads({
        pending: 0,
        uploaded: 0,
        queued: 0,
        processing: 0,
      }),
    ).toBe(false)

    expect(
      hasUnprocessedUploads({
        pending: 1,
        uploaded: 0,
        queued: 0,
        processing: 0,
      }),
    ).toBe(true)

    expect(
      hasUnprocessedUploads({
        pending: 0,
        uploaded: 1,
        queued: 0,
        processing: 0,
      }),
    ).toBe(true)

    expect(
      hasUnprocessedUploads({
        pending: 0,
        uploaded: 0,
        queued: 1,
        processing: 0,
      }),
    ).toBe(true)

    expect(
      hasUnprocessedUploads({
        pending: 0,
        uploaded: 0,
        queued: 0,
        processing: 1,
      }),
    ).toBe(true)
  })

  it('allows batch signing when every active file succeeded', () => {
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
        activeFileCount: 2,
        counts,
        signingStatusByBatchId,
      }),
    ).toEqual({
      canSignBatch: true,
      batchSigningStatus: 'unsigned',
    })
  })

  it('allows batch signing when some active files succeeded', () => {
    const batch = { id: 'batch-1', status: 'closed' as const }
    const signingStatusByBatchId = new Map([
      ['batch-1', { certificateCount: 2, signedCount: 0 }],
    ])

    expect(
      getBatchSigningState({
        batch,
        activeFileCount: 4,
        counts: {
          pending: 0,
          uploaded: 0,
          queued: 0,
          processing: 0,
          success: 2,
          duplicate: 1,
          error: 1,
        },
        signingStatusByBatchId,
      }),
    ).toEqual({
      canSignBatch: true,
      batchSigningStatus: 'unsigned',
    })

    expect(
      getBatchSigningState({
        batch,
        activeFileCount: 5,
        counts: {
          pending: 1,
          uploaded: 0,
          queued: 1,
          processing: 1,
          success: 2,
          duplicate: 0,
          error: 0,
        },
        signingStatusByBatchId,
      }),
    ).toEqual({
      canSignBatch: true,
      batchSigningStatus: 'unsigned',
    })

    expect(
      getBatchSigningState({
        batch,
        activeFileCount: 3,
        counts: {
          pending: 0,
          uploaded: 0,
          queued: 0,
          processing: 0,
          success: 0,
          duplicate: 0,
          error: 3,
        },
        signingStatusByBatchId,
      }),
    ).toEqual({
      canSignBatch: false,
      batchSigningStatus: 'unavailable',
    })
  })

  it('marks a signed batch partial when a later override adds an unsigned success', () => {
    const batch = { id: 'batch-1', status: 'closed' as const }
    const signingStatusByBatchId = new Map([
      ['batch-1', { certificateCount: 3, signedCount: 2 }],
    ])

    expect(
      getBatchSigningState({
        batch,
        activeFileCount: 4,
        counts: {
          pending: 0,
          uploaded: 0,
          queued: 0,
          processing: 0,
          success: 3,
          duplicate: 0,
          error: 1,
        },
        signingStatusByBatchId,
      }),
    ).toEqual({
      canSignBatch: true,
      batchSigningStatus: 'partial',
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

  it('separates active batches from Recently Deleted batches', () => {
    const batches = [
      buildBatchView({ id: 'batch-active' }),
      buildBatchView({
        id: 'batch-deleted',
        deletedAt: '2026-05-01T10:00:00.000Z',
        deletedByUserId: 'user-1',
        purgeAfterAt: '2026-05-31T10:00:00.000Z',
      }),
    ]

    expect(
      buildBatchListResponse(batches, {
        q: '',
        status: 'all',
        entity: '',
        repository: 'active',
        signingStatus: 'all',
        attention: 'all',
      }).batches.map((batch) => batch.id),
    ).toEqual(['batch-active'])
    expect(
      buildBatchListResponse(batches, {
        q: '',
        status: 'all',
        entity: '',
        repository: 'deleted',
        signingStatus: 'all',
        attention: 'all',
      }).batches.map((batch) => batch.id),
    ).toEqual(['batch-deleted'])
  })
})
