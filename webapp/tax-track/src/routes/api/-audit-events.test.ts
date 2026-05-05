import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  listAuditEvents: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/audit', () => ({
  listAuditEvents: mocks.listAuditEvents,
}))

vi.mock('@/lib/user-admin-server', () => ({
  jsonResponse: (payload: unknown, init: { status?: number } = {}) =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  notAuthenticatedResponse: (message = 'Authentication is required.') =>
    new Response(JSON.stringify({ error: message }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { auditEventsHandler } = await import('@/routes/api/audit/events')

const readJson = async (response: Response) => response.json()

describe('/api/audit/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.listAuditEvents.mockResolvedValue({
      events: [{ id: 'audit-1' }],
      pagination: {
        page: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      summary: {
        totalEvents: 1,
        uniqueActors: 1,
        systemEvents: 0,
      },
    })
  })

  it('requires authentication before listing audit events', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await auditEventsHandler({
      request: new Request('http://localhost/api/audit/events'),
    })

    expect(response.status).toBe(401)
    expect(mocks.listAuditEvents).not.toHaveBeenCalled()
  })

  it('requires audit route access', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await auditEventsHandler({
      request: new Request('http://localhost/api/audit/events'),
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('audit', 'admin')
    expect(mocks.listAuditEvents).not.toHaveBeenCalled()
  })

  it('parses and clamps query params before calling the service', async () => {
    const response = await auditEventsHandler({
      request: new Request(
        'http://localhost/api/audit/events?q=signed&action=certificate_signed&actor=ada&targetType=batch&dateFrom=2026-05-05&dateTo=2026-05-06&page=-5&pageSize=999',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.listAuditEvents).toHaveBeenCalledWith({
      q: 'signed',
      action: 'certificate_signed',
      actor: 'ada',
      targetType: 'batch',
      dateFrom: new Date('2026-05-04T16:00:00.000Z'),
      dateTo: new Date('2026-05-06T15:59:59.999Z'),
      page: 1,
      pageSize: 25,
    })
    await expect(readJson(response)).resolves.toEqual({
      events: [{ id: 'audit-1' }],
      pagination: {
        page: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      summary: {
        totalEvents: 1,
        uniqueActors: 1,
        systemEvents: 0,
      },
      user: {
        id: 'admin-1',
        role: 'admin',
      },
    })
  })
})
