import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveEntityScopeFilterById: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    execute: mocks.execute,
  }),
}))

vi.mock('@/lib/entities-server', () => ({
  resolveEntityScopeFilterById: mocks.resolveEntityScopeFilterById,
}))

const { listUploadBatches } = await import('@/lib/intake-server')

const dialect = new PgDialect()

const renderQuery = (query: unknown) => dialect.sqlToQuery(query as never)

const buildSearch = (
  overrides: Partial<Parameters<typeof listUploadBatches>[0]> = {},
): Parameters<typeof listUploadBatches>[0] => ({
  q: '',
  status: 'all',
  entity: '',
  signingStatus: 'all',
  attention: 'all',
  page: 1,
  pageSize: 25,
  ...overrides,
})

const metadataRow = {
  total: 12,
  active: 2,
  needsReview: 4,
  completed: 6,
  totalItems: 4,
  statuses: ['Active', 'Completed', 'Needs Review'],
  hasUnavailable: true,
  hasUnsigned: false,
  hasPartial: true,
  hasSigned: true,
}

const batchRow = {
  id: 'batch-1',
  name: 'April withholding',
  entityId: 1,
  entityShortName: 'AESI',
  entityCompanyName: 'Aboitiz Energy Solutions, Inc.',
  entityTin: '123456789000',
  entityName: 'AESI',
  createdByUserId: 'user-1',
  ownerName: 'Ada Admin',
  ownerEmail: 'ada@example.com',
  status: 'closed',
  overallStatus: 'Needs Review',
  canSignBatch: true,
  batchSigningStatus: 'partial',
  totalFiles: 5,
  openAttentionCount: 2,
  pendingCount: 0,
  uploadedCount: 0,
  queuedCount: 0,
  processingCount: 0,
  successCount: 3,
  duplicateCount: 1,
  errorCount: 1,
  lastActivityAt: new Date('2026-04-20T10:00:00.000Z'),
  closedAt: new Date('2026-04-20T09:30:00.000Z'),
  deletedAt: null,
  deletedByUserId: null,
  purgeAfterAt: null,
  createdAt: new Date('2026-04-20T09:00:00.000Z'),
  updatedAt: new Date('2026-04-20T10:00:00.000Z'),
}

describe('listUploadBatches scalable query path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveEntityScopeFilterById.mockResolvedValue(null)
    mocks.execute.mockResolvedValueOnce({
      rows: [{ ...metadataRow, pageRows: [batchRow] }],
    })
  })

  it('returns the existing response shape from SQL metadata and page rows', async () => {
    const result = await listUploadBatches(buildSearch())

    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      batches: [
        {
          id: 'batch-1',
          name: 'April withholding',
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
          totalFiles: 5,
          openAttentionCount: 2,
          counts: {
            pending: 0,
            uploaded: 0,
            queued: 0,
            processing: 0,
            success: 3,
            duplicate: 1,
            error: 1,
          },
          lastActivityAt: '2026-04-20T10:00:00.000Z',
          closedAt: '2026-04-20T09:30:00.000Z',
          deletedAt: null,
          deletedByUserId: null,
          purgeAfterAt: null,
          createdAt: '2026-04-20T09:00:00.000Z',
          updatedAt: '2026-04-20T10:00:00.000Z',
          entityName: 'AESI',
          ownerName: 'Ada Admin',
          ownerEmail: 'ada@example.com',
        },
      ],
      pagination: {
        page: 1,
        pageSize: 25,
        totalItems: 4,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      summary: {
        total: 12,
        active: 2,
        needsReview: 4,
        completed: 6,
      },
      filterOptions: {
        statuses: ['Active', 'Completed', 'Needs Review'],
        signingStatuses: ['unavailable', 'partial', 'signed'],
      },
    })
    expect(result.batches[0]).not.toHaveProperty('files')
  })

  it('returns metadata with an empty page when the page payload is empty', async () => {
    mocks.execute.mockReset()
    mocks.execute.mockResolvedValueOnce({
      rows: [{ ...metadataRow, totalItems: 0, pageRows: [] }],
    })

    const result = await listUploadBatches(buildSearch())

    expect(result.batches).toEqual([])
    expect(result.pagination.totalItems).toBe(0)
    expect(result.summary.total).toBe(12)
  })

  it('scopes active batches in candidate_batches before metric rollups', async () => {
    await listUploadBatches(buildSearch())

    const query = renderQuery(mocks.execute.mock.calls[0][0])
    expect(query.sql).toContain('candidate_batches as')
    expect(query.sql).toContain('b."deleted_at" is null')
    expect(query.sql).toContain('inner join candidate_batches')
    expect(query.sql.indexOf('candidate_batches as')).toBeLessThan(
      query.sql.indexOf('file_statuses as'),
    )
    expect(query.sql.indexOf('candidate_batches as')).toBeLessThan(
      query.sql.indexOf('successful_results as'),
    )
    expect(query.sql).toContain('"success_count" > 0')
  })

  it('scopes Recently Deleted batches in candidate_batches before metric rollups', async () => {
    await listUploadBatches(buildSearch({ repository: 'deleted' }))

    const query = renderQuery(mocks.execute.mock.calls[0][0])
    expect(query.sql).toContain('candidate_batches as')
    expect(query.sql).toContain('b."deleted_at" is not null')
    expect(query.sql).not.toContain('"deletedAt" is not null')
  })

  it('applies pagination in the SQL page query', async () => {
    await listUploadBatches(buildSearch({ page: 3, pageSize: 10 }))

    const query = renderQuery(mocks.execute.mock.calls[0][0])
    expect(query.sql).toContain('limit')
    expect(query.sql).toContain('offset')
    expect(query.params.slice(-2)).toEqual([10, 20])
  })

  it('pushes q, status, entity, signing, and attention filters into SQL', async () => {
    await listUploadBatches(
      buildSearch({
        q: '50% done',
        status: 'Needs Review',
        entity: 'AESI',
        signingStatus: 'partial',
        attention: 'needs_attention',
      }),
    )

    const query = renderQuery(mocks.execute.mock.calls[0][0])
    expect(query.sql).toContain('ilike')
    expect(query.sql).toContain('"openAttentionCount" > 0')
    expect(query.params).toContain('%50\\% done%')
    expect(query.params).toContain('needs review')
    expect(query.params).toContain('aesi')
    expect(query.params).toContain('partial')
  })

  it('excludes batches linked to non-archived sales report runs from reconciliation eligibility', async () => {
    await listUploadBatches(buildSearch({ reconciliationEligible: true }))

    const query = renderQuery(mocks.execute.mock.calls[0][0])
    expect(query.sql).toContain('"status" = \'closed\'')
    expect(query.sql).toContain('"successCount" > 0')
    expect(query.sql).toContain('not exists')
    expect(query.sql).toContain('sales_report_run_batches')
    expect(query.sql).toContain('sales_report_runs')
    expect(query.sql).toContain('srrb."batch_id" = projected_batches."id"')
    expect(query.sql).toContain('"archived_at" is null')
  })

  it('lets entity id filters win over legacy entity text', async () => {
    mocks.resolveEntityScopeFilterById.mockResolvedValue({
      id: 12,
      shortName: 'AESI',
      companyName: 'Aboitiz Energy Solutions, Inc.',
      tin: '123456789000',
    })

    await listUploadBatches(
      buildSearch({
        entity: 'Legacy entity text',
        entityId: '12',
      }),
    )

    const query = renderQuery(mocks.execute.mock.calls[0][0])
    expect(query.params).toContain(12)
    expect(query.params).toContain('aesi')
    expect(query.params).not.toContain('legacy entity text')
  })
})
