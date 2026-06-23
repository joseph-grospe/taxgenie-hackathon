import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { intakeBatches, intakeFiles } from '@/lib/schema'

type IntakeBatchRecord = typeof intakeBatches.$inferSelect
type IntakeFileRecord = typeof intakeFiles.$inferSelect

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  selectRows: [] as Array<Array<unknown>>,
}))

const createSelectBuilder = (rows: Array<unknown>) => {
  const result = {
    limit: vi.fn(() => Promise.resolve(rows)),
    orderBy: vi.fn(() => Promise.resolve(rows)),
  }
  const where = {
    where: vi.fn(() => result),
  }

  return {
    from: vi.fn(() => where),
  }
}

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    execute: mocks.execute,
    select: mocks.select,
  }),
}))

vi.mock('@/lib/entities-server', () => ({
  resolveEntityScopeFilterById: vi.fn(),
}))

const { getUploadBatchById, listUploadBatchFiles } =
  await import('@/lib/intake-server')

const dialect = new PgDialect()

const renderQuery = (query: unknown) => dialect.sqlToQuery(query as never)

const buildBatchRecord = (
  overrides: Partial<IntakeBatchRecord> = {},
): IntakeBatchRecord => ({
  id: '7de4cd8e-6be8-4928-a2cb-e417654c8e15',
  name: 'April upload batch',
  entityId: 1,
  entityShortName: 'AESI',
  entityCompanyName: 'Aboitiz Energy Solutions, Inc.',
  entityTin: '123456789000',
  createdByUserId: 'user-1',
  status: 'closed',
  totalFiles: 4,
  lastActivityAt: new Date('2026-04-20T10:00:00.000Z'),
  closedAt: new Date('2026-04-20T09:30:00.000Z'),
  deletedAt: null,
  deletedByUserId: null,
  purgeAfterAt: null,
  createdAt: new Date('2026-04-20T09:00:00.000Z'),
  updatedAt: new Date('2026-04-20T10:00:00.000Z'),
  ...overrides,
})

const buildFileRecord = (
  overrides: Partial<IntakeFileRecord> = {},
): IntakeFileRecord => ({
  id: '9de4cd8e-6be8-4928-a2cb-e417654c8e15',
  batchId: '7de4cd8e-6be8-4928-a2cb-e417654c8e15',
  uploadedByUserId: 'user-1',
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
  uploadStatus: 'uploaded',
  queueStatus: 'queued',
  processingStatus: 'success',
  removedFromBatchAt: null,
  removedFromBatchByUserId: null,
  currentPhase: null,
  currentStep: null,
  errorMessage: null,
  uploadedAt: new Date('2026-04-20T09:05:00.000Z'),
  queuedAt: new Date('2026-04-20T09:06:00.000Z'),
  processingStartedAt: new Date('2026-04-20T09:07:00.000Z'),
  processingFinishedAt: new Date('2026-04-20T09:08:00.000Z'),
  createdAt: new Date('2026-04-20T09:00:00.000Z'),
  updatedAt: new Date('2026-04-20T09:08:00.000Z'),
  ...overrides,
})

const summaryRow = {
  activeFileCount: 4,
  pendingCount: 0,
  uploadedCount: 0,
  queuedCount: 0,
  processingCount: 0,
  successCount: 2,
  duplicateCount: 1,
  errorCount: 0,
  openAttentionCount: 1,
  certificateCount: 2,
  signedCount: 1,
}

const filesMetadataRow = {
  totalItems: 42,
  hasPending: true,
  hasUploaded: false,
  hasQueued: true,
  hasProcessing: false,
  hasSuccess: true,
  hasDuplicate: true,
  hasError: false,
}

describe('batch detail scalable query path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectRows.length = 0
    mocks.select.mockImplementation(() => {
      const rows = mocks.selectRows.shift()
      if (!rows) {
        throw new Error('Unexpected select query')
      }

      return createSelectBuilder(rows)
    })
  })

  it('builds the default batch detail summary from SQL aggregates', async () => {
    mocks.selectRows.push([buildBatchRecord()])
    mocks.execute.mockResolvedValueOnce({ rows: [summaryRow] })

    const result = await getUploadBatchById({
      batchId: '7de4cd8e-6be8-4928-a2cb-e417654c8e15',
    })

    expect(mocks.select).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    const summaryQuery = renderQuery(mocks.execute.mock.calls[0][0])
    expect(summaryQuery.sql).toContain('signing_rollups as')
    expect(summaryQuery.sql).not.toMatch(/\),\s*select/u)
    expect(result).toEqual({
      status: 'ok',
      batch: {
        id: '7de4cd8e-6be8-4928-a2cb-e417654c8e15',
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
        overallStatus: 'Needs Review',
        canSignBatch: true,
        batchSigningStatus: 'partial',
        totalFiles: 4,
        openAttentionCount: 1,
        counts: {
          pending: 0,
          uploaded: 0,
          queued: 0,
          processing: 0,
          success: 2,
          duplicate: 1,
          error: 0,
        },
        lastActivityAt: '2026-04-20T10:00:00.000Z',
        closedAt: '2026-04-20T09:30:00.000Z',
        deletedAt: null,
        deletedByUserId: null,
        purgeAfterAt: null,
        createdAt: '2026-04-20T09:00:00.000Z',
        updatedAt: '2026-04-20T10:00:00.000Z',
        files: [],
      },
    })
  })

  it('keeps includeFiles=true on the existing full-batch view path', async () => {
    const batch = buildBatchRecord()
    mocks.selectRows.push([batch], [batch], [])

    const result = await getUploadBatchById({
      batchId: batch.id,
      includeFiles: true,
    })

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.select).toHaveBeenCalledTimes(3)
    expect(result.status).toBe('ok')
    expect(result.batch?.files).toEqual([])
  })
})

describe('batch files scalable query path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectRows.length = 0
    mocks.select.mockImplementation(() => {
      const rows = mocks.selectRows.shift()
      if (!rows) {
        throw new Error('Unexpected select query')
      }

      return createSelectBuilder(rows)
    })
  })

  it('applies pagination in SQL and hydrates only the current page', async () => {
    const batch = buildBatchRecord()
    const file = buildFileRecord()
    mocks.selectRows.push([batch], [file], [], [])
    mocks.execute
      .mockResolvedValueOnce({ rows: [filesMetadataRow] })
      .mockResolvedValueOnce({ rows: [{ id: file.id }] })

    const result = await listUploadBatchFiles({
      batchId: batch.id,
      q: '',
      status: 'all',
      attention: 'all',
      page: 3,
      pageSize: 10,
    })

    const pageQuery = renderQuery(mocks.execute.mock.calls[1][0])
    expect(pageQuery.sql).toContain('limit')
    expect(pageQuery.sql).toContain('offset')
    expect(pageQuery.params.slice(-2)).toEqual([10, 20])
    expect(mocks.select).toHaveBeenCalledTimes(4)
    expect(result.status).toBe('ok')
    expect(result.result?.pagination).toEqual({
      page: 3,
      pageSize: 10,
      totalItems: 42,
      totalPages: 5,
      hasNextPage: true,
      hasPreviousPage: true,
    })
    expect(result.result?.filterOptions).toEqual({
      statuses: ['pending', 'queued', 'success', 'duplicate'],
    })
    expect(result.result?.files.map((upload) => upload.id)).toEqual([file.id])
  })

  it('pushes q, status, and open attention filters into SQL', async () => {
    const batch = buildBatchRecord()
    mocks.selectRows.push([batch])
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ ...filesMetadataRow, totalItems: 0 }] })
      .mockResolvedValueOnce({ rows: [] })

    await listUploadBatchFiles({
      batchId: batch.id,
      q: '50% done',
      status: 'duplicate',
      attention: 'open',
      page: 1,
      pageSize: 25,
    })

    const pageQuery = renderQuery(mocks.execute.mock.calls[1][0])
    expect(pageQuery.sql).toContain('ilike')
    expect(pageQuery.sql).toContain('"hasOpenAttention" = true')
    expect(pageQuery.params).toContain('%50\\% done%')
    expect(pageQuery.params).toContain('duplicate')
    expect(mocks.select).toHaveBeenCalledTimes(1)
  })
})
