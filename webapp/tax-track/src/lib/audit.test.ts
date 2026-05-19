import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEventView } from '@/lib/audit'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: mocks.getDb,
}))

const { listAllAuditEvents, listAuditEvents } = await import('@/lib/audit')
const { buildAuditExport } = await import('@/lib/audit-export-server')

type QueryCalls = {
  limits: Array<number>
  offsets: Array<number>
  wheres: Array<unknown>
}

const createDb = ({
  events,
  users,
  counts = [events.length, 1, 0],
  userSearchResults = [],
}: {
  events: Array<Record<string, unknown>>
  users: Array<Record<string, unknown>>
  counts?: Array<number>
  userSearchResults?: Array<Array<Record<string, unknown>>>
}) => {
  const calls: QueryCalls = {
    limits: [],
    offsets: [],
    wheres: [],
  }
  const countQueue = counts.map((value) => [{ value }])
  const userQueue = [...userSearchResults, users]
  const db = {
    select: vi.fn((selection?: Record<string, unknown>) => {
      if (selection && 'value' in selection) {
        return {
          from: vi.fn(() => ({
            where: vi.fn((condition: unknown) => {
              calls.wheres.push(condition)
              return Promise.resolve(countQueue.shift() ?? [{ value: 0 }])
            }),
          })),
        }
      }

      if (selection && 'id' in selection) {
        return {
          from: vi.fn(() => ({
            where: vi.fn((condition: unknown) => {
              calls.wheres.push(condition)
              return Promise.resolve(userQueue.shift() ?? [])
            }),
          })),
        }
      }

      return {
        from: vi.fn(() => ({
          where: vi.fn((condition: unknown) => {
            calls.wheres.push(condition)
            const orderedQuery = {
              limit: vi.fn((limit: number) => {
                calls.limits.push(limit)
                return {
                  offset: vi.fn((offset: number) => {
                    calls.offsets.push(offset)
                    return Promise.resolve(events)
                  }),
                }
              }),
              then: (
                resolve: (value: Array<Record<string, unknown>>) => unknown,
                reject: (reason: unknown) => unknown,
              ) => Promise.resolve(events).then(resolve, reject),
            }

            return {
              orderBy: vi.fn(() => orderedQuery),
            }
          }),
        })),
      }
    }),
  }

  return { db, calls }
}

describe('audit event listing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('paginates events, returns filtered totals, and resolves user targets', async () => {
    const { db, calls } = createDb({
      counts: [26, 3, 4],
      events: [
        {
          id: 'audit-1',
          occurredAt: new Date('2026-05-05T00:00:00.000Z'),
          eventType: 'user_created',
          actorUserId: 'admin-1',
          targetId: 'user-1',
          targetType: 'user',
          metadata: null,
          ipAddress: null,
          userAgent: null,
        },
      ],
      users: [
        {
          id: 'admin-1',
          name: 'Ada Admin',
          email: 'ada@example.com',
        },
        {
          id: 'user-1',
          name: 'Eli Editor',
          email: 'eli@example.com',
        },
      ],
    })
    mocks.getDb.mockReturnValue(db)

    const result = await listAuditEvents({ page: 2, pageSize: 10 })

    expect(calls.limits).toEqual([10])
    expect(calls.offsets).toEqual([10])
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 10,
      totalItems: 26,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    })
    expect(result.summary).toEqual({
      totalEvents: 26,
      uniqueActors: 3,
      systemEvents: 4,
    })
    expect(result.events[0]?.actor).toEqual({
      id: 'admin-1',
      name: 'Ada Admin',
      email: 'ada@example.com',
    })
    expect(result.events[0]?.target).toEqual({
      id: 'user-1',
      name: 'Eli Editor',
      email: 'eli@example.com',
    })
  })

  it('does not query users when events have no actor or user target ids', async () => {
    const { db } = createDb({
      events: [
        {
          id: 'audit-2',
          occurredAt: new Date('2026-05-05T00:00:00.000Z'),
          eventType: 'dev_data_reset',
          actorUserId: null,
          targetId: null,
          targetType: null,
          metadata: null,
          ipAddress: null,
          userAgent: null,
        },
      ],
      users: [],
    })
    mocks.getDb.mockReturnValue(db)

    const result = await listAuditEvents({ pageSize: 25 })

    expect(result.events[0]?.actor).toBeNull()
    expect(result.events[0]?.target).toBeNull()
    expect(db.select).toHaveBeenCalledTimes(4)
  })

  it('applies search, action, actor, target type, date, and safe pagination inputs', async () => {
    const { db, calls } = createDb({
      counts: [0, 0, 0],
      events: [],
      users: [],
      userSearchResults: [[{ id: 'user-search-1' }], [{ id: 'actor-1' }]],
    })
    mocks.getDb.mockReturnValue(db)

    const result = await listAuditEvents({
      q: 'signed',
      action: 'certificate_signed',
      actor: 'Ada',
      targetType: 'batch',
      dateFrom: new Date('2026-05-04T16:00:00.000Z'),
      dateTo: new Date('2026-05-05T15:59:59.999Z'),
      page: -10,
      pageSize: 999,
    })

    expect(calls.limits).toEqual([25])
    expect(calls.offsets).toEqual([0])
    expect(calls.wheres).toHaveLength(6)
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 25,
      totalItems: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    })
  })

  it('lists every matching event for exports and resolves users', async () => {
    const { db, calls } = createDb({
      events: [
        {
          id: 'audit-3',
          occurredAt: new Date('2026-05-05T00:00:00.000Z'),
          eventType: 'user_created',
          actorUserId: 'admin-1',
          targetId: 'user-1',
          targetType: 'user',
          metadata: { source: 'settings' },
          ipAddress: '192.0.2.10',
          userAgent: 'Mozilla/5.0',
        },
      ],
      users: [
        {
          id: 'admin-1',
          name: 'Ada Admin',
          email: 'ada@example.com',
        },
        {
          id: 'user-1',
          name: 'Eli Editor',
          email: 'eli@example.com',
        },
      ],
      userSearchResults: [[]],
    })
    mocks.getDb.mockReturnValue(db)

    const result = await listAllAuditEvents({
      q: 'created',
      action: 'user_created',
    })

    expect(calls.limits).toEqual([])
    expect(calls.offsets).toEqual([])
    expect(result).toHaveLength(1)
    expect(result[0]?.actor).toEqual({
      id: 'admin-1',
      name: 'Ada Admin',
      email: 'ada@example.com',
    })
    expect(result[0]?.target).toEqual({
      id: 'user-1',
      name: 'Eli Editor',
      email: 'eli@example.com',
    })
  })

  it('builds full-field CSV audit exports', async () => {
    const events: Array<AuditEventView> = [
      {
        id: 'audit-4',
        occurredAt: new Date('2026-05-05T00:00:00.000Z'),
        eventType: 'user_created',
        actorUserId: 'admin-1',
        targetId: 'user-1',
        targetType: 'user',
        metadata: { fileName: 'source.pdf', rowCount: 2 },
        ipAddress: '192.0.2.10',
        userAgent: 'Mozilla/5.0',
        actor: {
          id: 'admin-1',
          name: 'Ada Admin',
          email: 'ada@example.com',
        },
        target: {
          id: 'user-1',
          name: 'Eli Editor',
          email: 'eli@example.com',
        },
      },
    ]

    const result = await buildAuditExport(events, 'csv')
    const content = result.content.toString('utf8')

    expect(result.contentType).toBe('text/csv; charset=utf-8')
    expect(result.fileName).toMatch(/^Audit-Trail-\d{8}-\d{6}\.csv$/)
    expect(result.rowCount).toBe(1)
    expect(content).toContain('Audit ID')
    expect(content).toContain('Occurred at (Asia/Manila)')
    expect(content).toContain('Ada Admin')
    expect(content).toContain('Eli Editor')
    expect(content).toContain('source.pdf')
    expect(content).toContain('192.0.2.10')
    expect(content).toContain('Mozilla/5.0')
  })

  it('builds xlsx audit exports', async () => {
    const result = await buildAuditExport([], 'xlsx')

    expect(result.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(result.fileName).toMatch(/^Audit-Trail-\d{8}-\d{6}\.xlsx$/)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.rowCount).toBe(0)
  })
})
