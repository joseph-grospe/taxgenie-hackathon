import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReferenceDataListOptions } from '@/lib/reference-data-server'

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: dbMocks.getDb,
}))

const { listReferenceDataRows } = await import('@/lib/reference-data-server')

const dialect = new PgDialect()
const renderSql = (query: unknown) => dialect.sqlToQuery(query as never)

const buildOptions = (
  overrides: Partial<ReferenceDataListOptions> = {},
): ReferenceDataListOptions => ({
  q: '',
  region: '',
  entity: '',
  government: 'all',
  tinState: 'all',
  emailState: 'all',
  taxType: '',
  rate: '',
  sort: 'customerName',
  direction: 'asc',
  page: 1,
  pageSize: 25,
  ...overrides,
})

const createListDb = ({
  total = 0,
  governmentCustomers = 0,
  rows = [],
  distinctRows = [],
}: {
  total?: number
  governmentCustomers?: number
  rows?: Array<Record<string, unknown>>
  distinctRows?: Array<Array<{ value: string | number | null }>>
} = {}) => {
  const record = {
    countWhere: undefined as unknown,
    rowWhere: undefined as unknown,
    orderBy: [] as Array<unknown>,
    limit: 0,
    offset: 0,
    facetWhere: [] as Array<unknown>,
  }
  const remainingCounts = [total, governmentCustomers]
  const remainingDistinctRows = [...distinctRows]

  const db = {
    select: vi.fn((selection: Record<string, unknown>) => {
      const isCount =
        Object.keys(selection).length === 1 && 'value' in selection

      return {
        from: vi.fn(() => {
          if (isCount) {
            return {
              where: vi.fn((where: unknown) => {
                record.countWhere = where
                return Promise.resolve([
                  { value: remainingCounts.shift() ?? total },
                ])
              }),
            }
          }

          const builder = {
            where: vi.fn((where: unknown) => {
              record.rowWhere = where
              return builder
            }),
            orderBy: vi.fn((...orderBy: Array<unknown>) => {
              record.orderBy = orderBy
              return builder
            }),
            limit: vi.fn((limit: number) => {
              record.limit = limit
              return builder
            }),
            offset: vi.fn((offset: number) => {
              record.offset = offset
              return Promise.resolve(rows)
            }),
          }
          return builder
        }),
      }
    }),
    selectDistinct: vi.fn(() => ({
      from: vi.fn(() => {
        const builder = {
          where: vi.fn((where: unknown) => {
            record.facetWhere.push(where)
            return builder
          }),
          orderBy: vi.fn(() =>
            Promise.resolve(remainingDistinctRows.shift() ?? []),
          ),
        }
        return builder
      }),
    })),
  }

  return { db, record }
}

describe('reference-data-server list queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses case-insensitive exact masterlist facets and a stable ID tie-breaker', async () => {
    const { db, record } = createListDb({
      total: 2,
      governmentCustomers: 1,
      distinctRows: [[{ value: 'NCR' }], [{ value: 'Manila' }]],
    })
    dbMocks.getDb.mockReturnValue(db)

    const result = await listReferenceDataRows(
      'masterlist',
      buildOptions({
        region: 'ncr',
        entity: 'MANILA',
        government: 'yes',
        sort: 'customerName',
        direction: 'desc',
      }),
    )

    const where = renderSql(record.rowWhere)
    expect(where.sql).toContain('lower(btrim(coalesce')
    expect(where.params).toContain('ncr')
    expect(where.params).toContain('MANILA')
    expect(where.params).toContain(true)
    expect(renderSql(record.orderBy[0]).sql).toContain('customer_name" desc')
    expect(renderSql(record.orderBy[1]).sql).toContain('"id" asc')
    expect(result.facets.regions).toEqual(['NCR'])
    expect(result.facets.entities).toEqual(['Manila'])
    expect(result.facets.governmentCustomers).toBe(1)
  })

  it('treats null, empty, and whitespace-only entity values as missing', async () => {
    const { db, record } = createListDb({ total: 4 })
    dbMocks.getDb.mockReturnValue(db)

    await listReferenceDataRows(
      'entities',
      buildOptions({
        tinState: 'missing',
        emailState: 'missing',
        sort: 'shortName',
      }),
    )

    const where = renderSql(record.rowWhere)
    expect(where.sql.match(/nullif\(btrim\(coalesce/g)).toHaveLength(3)
    expect(where.sql.match(/is null/g)).toHaveLength(3)
  })

  it('filters ATC tax types case-insensitively and rates by stored value', async () => {
    const { db, record } = createListDb({
      total: 1,
      distinctRows: [[{ value: 'Income Tax' }], [{ value: 0.02 }]],
    })
    dbMocks.getDb.mockReturnValue(db)

    const result = await listReferenceDataRows(
      'atc-codes',
      buildOptions({
        taxType: 'income tax',
        rate: '0.02',
        sort: 'rate',
      }),
    )

    const where = renderSql(record.rowWhere)
    expect(where.sql).toContain('lower(btrim(coalesce')
    expect(where.sql).toContain('"rate" =')
    expect(where.params).toContain('income tax')
    expect(where.params).toContain(0.02)
    expect(result.facets.taxTypes).toEqual(['Income Tax'])
    expect(result.facets.rates).toEqual([0.02])
  })

  it('clamps out-of-range pages before applying limit and offset', async () => {
    const { db, record } = createListDb({ total: 60 })
    dbMocks.getDb.mockReturnValue(db)

    const result = await listReferenceDataRows(
      'entities',
      buildOptions({ page: 9, pageSize: 25, sort: 'shortName' }),
    )

    expect(result.page).toBe(3)
    expect(result.totalPages).toBe(3)
    expect(record.limit).toBe(25)
    expect(record.offset).toBe(50)
  })
})
