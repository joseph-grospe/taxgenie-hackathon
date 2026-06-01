import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  canExportExcel: vi.fn(),
  exportIssueDocuments: vi.fn(),
  listIssueDocuments: vi.fn(),
  logAuditEvent: vi.fn(),
  parseEntityFilterIdInput: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
  canExport: {
    excel: mocks.canExportExcel,
  },
}))

vi.mock('@/lib/audit', () => ({
  logAuditEvent: mocks.logAuditEvent,
}))

vi.mock('@/lib/documents-server', () => ({
  exportIssueDocuments: mocks.exportIssueDocuments,
  listIssueDocuments: mocks.listIssueDocuments,
}))

vi.mock('@/lib/entities-server', () => ({
  parseEntityFilterIdInput: mocks.parseEntityFilterIdInput,
}))

vi.mock('@/lib/user-admin-server', () => ({
  badRequestResponse: (message: string) =>
    new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error.',
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

const { issueDocumentsExportHandler } = await import(
  '@/routes/api/documents/issues.export'
)

const readJson = async (response: Response) => response.json()

describe('/api/documents/issues/export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'editor-1',
      role: 'editor',
      canExportExcel: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canExportExcel.mockReturnValue(true)
    mocks.parseEntityFilterIdInput.mockReturnValue(null)
    mocks.exportIssueDocuments.mockResolvedValue({
      fileName: 'Issues-Queue-20260518-100000.csv',
      content: Buffer.from('csv-bytes'),
      contentType: 'text/csv; charset=utf-8',
      rowCount: 2,
    })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('requires authentication before exporting issue documents', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await issueDocumentsExportHandler({
      request: new Request('http://localhost/api/documents/issues/export'),
    })

    expect(response.status).toBe(401)
    expect(mocks.exportIssueDocuments).not.toHaveBeenCalled()
  })

  it('requires issues route access', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await issueDocumentsExportHandler({
      request: new Request('http://localhost/api/documents/issues/export'),
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('issues', 'editor')
    expect(mocks.exportIssueDocuments).not.toHaveBeenCalled()
  })

  it('requires export permission after route access', async () => {
    mocks.canExportExcel.mockReturnValue(false)

    const response = await issueDocumentsExportHandler({
      request: new Request('http://localhost/api/documents/issues/export'),
    })

    expect(response.status).toBe(403)
    expect(mocks.canExportExcel).toHaveBeenCalledWith('editor', true)
    expect(mocks.exportIssueDocuments).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid direct entity id filters', async () => {
    mocks.parseEntityFilterIdInput.mockImplementation(() => {
      throw new Error('Invalid entity filter.')
    })

    const response = await issueDocumentsExportHandler({
      request: new Request(
        'http://localhost/api/documents/issues/export?entityId=bad',
      ),
    })

    expect(response.status).toBe(400)
    expect(mocks.exportIssueDocuments).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Invalid entity filter.',
    })
  })

  it('exports filtered CSV issue documents and logs the export', async () => {
    const request = new Request(
      'http://localhost/api/documents/issues/export?status=duplicate&q=missing&severity=High&owner=Revenue%20Ops&entity=AESI&year=2025&month=December&quarter=Q4&dateFrom=2026-05-01&dateTo=2026-05-08&page=4&pageSize=100',
    )

    const response = await issueDocumentsExportHandler({ request })

    expect(response.status).toBe(200)
    expect(mocks.exportIssueDocuments).toHaveBeenCalledWith({
      status: 'duplicate',
      q: 'missing',
      severity: 'High',
      owner: 'Revenue Ops',
      entity: 'AESI',
      entityId: '',
      year: '2025',
      month: 'December',
      quarter: 'Q4',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-08',
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(request, {
      actorUserId: 'editor-1',
      eventType: 'issues_exported',
      metadata: {
        format: 'csv',
        filters: {
          status: 'duplicate',
          q: 'missing',
          severity: 'High',
          owner: 'Revenue Ops',
          entity: 'AESI',
          entityId: null,
          year: '2025',
          month: 'December',
          quarter: 'Q4',
          dateFrom: '2026-05-01',
          dateTo: '2026-05-08',
        },
        rowCount: 2,
      },
    })
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Issues-Queue-20260518-100000.csv"',
    )
    const content = Buffer.from(await response.arrayBuffer())
    expect(content.equals(Buffer.from('csv-bytes'))).toBe(true)
  })
})
