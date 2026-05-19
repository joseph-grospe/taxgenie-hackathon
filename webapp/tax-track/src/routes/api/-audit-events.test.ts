import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  exportAuditEvents: vi.fn(),
  listAuditEvents: vi.fn(),
  logAuditEvent: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/audit', () => ({
  listAuditEvents: mocks.listAuditEvents,
  logAuditEvent: mocks.logAuditEvent,
}))

vi.mock('@/lib/audit-export-server', () => ({
  exportAuditEvents: mocks.exportAuditEvents,
}))

vi.mock('@/lib/user-admin-server', () => ({
  badRequestResponse: (message: string) =>
    new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
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
const { auditExportHandler } = await import('@/routes/api/audit/export')

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
    mocks.exportAuditEvents.mockResolvedValue({
      fileName: 'Audit-Trail-20260518-100000.csv',
      content: Buffer.from('csv-bytes'),
      contentType: 'text/csv; charset=utf-8',
      rowCount: 2,
    })
    mocks.logAuditEvent.mockResolvedValue(undefined)
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

describe('/api/audit/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.exportAuditEvents.mockResolvedValue({
      fileName: 'Audit-Trail-20260518-100000.csv',
      content: Buffer.from('csv-bytes'),
      contentType: 'text/csv; charset=utf-8',
      rowCount: 2,
    })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('requires authentication before exporting audit events', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await auditExportHandler({
      request: new Request('http://localhost/api/audit/export?format=csv'),
    })

    expect(response.status).toBe(401)
    expect(mocks.exportAuditEvents).not.toHaveBeenCalled()
  })

  it('requires audit route access before exporting audit events', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await auditExportHandler({
      request: new Request('http://localhost/api/audit/export?format=csv'),
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('audit', 'admin')
    expect(mocks.exportAuditEvents).not.toHaveBeenCalled()
  })

  it('rejects unsupported export formats', async () => {
    const response = await auditExportHandler({
      request: new Request('http://localhost/api/audit/export?format=pdf'),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Export format must be either csv or xlsx.',
    })
    expect(mocks.exportAuditEvents).not.toHaveBeenCalled()
  })

  it('exports filtered CSV audit events and logs the export', async () => {
    const request = new Request(
      'http://localhost/api/audit/export?format=csv&q=signed&action=certificate_signed&actor=ada&targetType=batch&dateFrom=2026-05-05&dateTo=2026-05-06&page=4&pageSize=100',
    )

    const response = await auditExportHandler({ request })

    expect(response.status).toBe(200)
    expect(mocks.exportAuditEvents).toHaveBeenCalledWith(
      {
        q: 'signed',
        action: 'certificate_signed',
        actor: 'ada',
        targetType: 'batch',
        dateFrom: new Date('2026-05-04T16:00:00.000Z'),
        dateTo: new Date('2026-05-06T15:59:59.999Z'),
      },
      'csv',
    )
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(request, {
      actorUserId: 'admin-1',
      eventType: 'audit_exported',
      metadata: {
        format: 'csv',
        filters: {
          q: 'signed',
          action: 'certificate_signed',
          actor: 'ada',
          targetType: 'batch',
          dateFrom: '2026-05-05',
          dateTo: '2026-05-06',
        },
        rowCount: 2,
      },
    })
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Audit-Trail-20260518-100000.csv"',
    )
    const content = Buffer.from(await response.arrayBuffer())
    expect(content.equals(Buffer.from('csv-bytes'))).toBe(true)
  })

  it('returns the workbook attachment for xlsx exports', async () => {
    mocks.exportAuditEvents.mockResolvedValue({
      fileName: 'Audit-Trail-20260518-100000.xlsx',
      content: Buffer.from('xlsx-bytes'),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      rowCount: 1,
    })

    const response = await auditExportHandler({
      request: new Request('http://localhost/api/audit/export?format=xlsx'),
    })

    expect(response.status).toBe(200)
    expect(mocks.exportAuditEvents).toHaveBeenCalledWith(
      {
        q: null,
        action: null,
        actor: null,
        targetType: null,
        dateFrom: null,
        dateTo: null,
      },
      'xlsx',
    )
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Audit-Trail-20260518-100000.xlsx"',
    )
    const content = Buffer.from(await response.arrayBuffer())
    expect(content.equals(Buffer.from('xlsx-bytes'))).toBe(true)
  })
})
