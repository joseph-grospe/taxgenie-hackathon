import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: mocks.getDb,
}))

const { listAuditEvents } = await import('@/lib/audit')

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
            return {
              orderBy: vi.fn(() => ({
                limit: vi.fn((limit: number) => {
                  calls.limits.push(limit)
                  return {
                    offset: vi.fn((offset: number) => {
                      calls.offsets.push(offset)
                      return Promise.resolve(events)
                    }),
                  }
                }),
              })),
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
})
