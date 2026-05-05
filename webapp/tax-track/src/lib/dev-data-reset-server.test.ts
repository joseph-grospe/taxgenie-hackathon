import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getDb: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: mocks.getDb,
}))

const {
  DEV_DATA_RESET_TABLES,
  DEV_DATA_RESET_TRUNCATE_STATEMENT,
  getDevDataResetStage,
  isDevDataResetAvailable,
  resetDevData,
} = await import('@/lib/dev-data-reset-server')

const getSqlText = (query: unknown) => {
  if (!query || typeof query !== 'object' || !('queryChunks' in query)) {
    return ''
  }

  const chunk = (
    query as { queryChunks?: Array<{ value?: Array<string> }> }
  ).queryChunks?.at(0)
  return chunk ? (chunk.value?.[0] ?? '') : ''
}

describe('dev data reset environment gate', () => {
  it('is disabled without local development or a dev stage', () => {
    expect(isDevDataResetAvailable({ NODE_ENV: 'test' })).toBe(false)
    expect(getDevDataResetStage({ NODE_ENV: 'test' })).toBe('unknown')
  })

  it('is enabled for local development and dev stages', () => {
    expect(isDevDataResetAvailable({ NODE_ENV: 'development' })).toBe(true)
    expect(getDevDataResetStage({ NODE_ENV: 'development' })).toBe(
      'local-development',
    )
    expect(
      isDevDataResetAvailable({
        NODE_ENV: 'production',
        TAXTRACK_APP_STAGE: 'dev-app',
      }),
    ).toBe(true)
    expect(
      getDevDataResetStage({
        NODE_ENV: 'production',
        TAXTRACK_APP_STAGE: 'dev-app',
      }),
    ).toBe('dev-app')
  })

  it('keeps prod stages disabled even if NODE_ENV looks local', () => {
    expect(
      isDevDataResetAvailable({
        NODE_ENV: 'development',
        TAXTRACK_APP_STAGE: 'prod',
      }),
    ).toBe(false)
    expect(
      isDevDataResetAvailable({
        NODE_ENV: 'development',
        SST_STAGE: 'prod-web',
      }),
    ).toBe(false)
    expect(
      isDevDataResetAvailable({
        NODE_ENV: 'production',
        TAXTRACK_APP_STAGE: 'dev-app',
        SST_STAGE: 'prod',
      }),
    ).toBe(false)
  })
})

describe('resetDevData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockResolvedValue({ rows: [{ count: '2' }] })
    mocks.transaction.mockImplementation(
      async (
        callback: (tx: { execute: typeof mocks.execute }) => Promise<unknown>,
      ) => callback({ execute: mocks.execute }),
    )
    mocks.getDb.mockReturnValue({
      transaction: mocks.transaction,
    })
  })

  it('collects counts and truncates only the allowlisted runtime tables', async () => {
    const result = await resetDevData({
      NODE_ENV: 'production',
      TAXTRACK_APP_STAGE: 'dev-app',
    })

    expect(result.stage).toBe('dev-app')
    expect(result.deletedCounts.intake_files).toBe(2)
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(DEV_DATA_RESET_TABLES.length + 1)

    const countStatements = mocks.execute.mock.calls
      .slice(0, DEV_DATA_RESET_TABLES.length)
      .map(([query]) => getSqlText(query))
    expect(countStatements).toEqual(
      DEV_DATA_RESET_TABLES.map(
        (tableName) => `select count(*)::int as count from "${tableName}"`,
      ),
    )

    const truncateStatement = getSqlText(mocks.execute.mock.calls.at(-1)?.[0])
    expect(truncateStatement).toBe(DEV_DATA_RESET_TRUNCATE_STATEMENT)
    expect(truncateStatement).toContain('restart identity cascade')
    expect(truncateStatement).not.toContain('"user"')
    expect(truncateStatement).not.toContain('security_audit_logs')
    expect(truncateStatement).not.toContain('masterlist')
    expect(truncateStatement).not.toContain('entities')
    expect(truncateStatement).not.toContain('certificate_signature_templates')
  })
})
