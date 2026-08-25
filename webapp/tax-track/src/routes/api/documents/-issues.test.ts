import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  listIssueDocuments: vi.fn(),
  parseEntityFilterIdInput: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/documents-server', () => ({
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

const { issueDocumentsHandler } = await import('@/routes/api/documents/issues')

const readJson = async (response: Response) => response.json()

describe('/api/documents/issues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.parseEntityFilterIdInput.mockReturnValue(null)
    mocks.listIssueDocuments.mockResolvedValue({
      documents: [{ id: 'issue-1' }],
      pagination: {
        page: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      summary: {
        totalIssues: 1,
        reviewCount: 0,
        errorCount: 1,
        duplicateCount: 0,
      },
      filterOptions: {
        severities: ['High'],
        owners: ['Revenue Ops'],
        years: ['2025'],
        months: ['December'],
        quarters: ['Q4'],
      },
    })
  })

  it('requires authentication before listing issue documents', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await issueDocumentsHandler({
      request: new Request('http://localhost/api/documents/issues'),
    })

    expect(response.status).toBe(401)
    expect(mocks.listIssueDocuments).not.toHaveBeenCalled()
  })

  it('requires issues route access', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await issueDocumentsHandler({
      request: new Request('http://localhost/api/documents/issues'),
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('issues', 'admin')
    expect(mocks.listIssueDocuments).not.toHaveBeenCalled()
  })

  it('parses filters and pagination before calling the service', async () => {
    const response = await issueDocumentsHandler({
      request: new Request(
        'http://localhost/api/documents/issues?status=duplicate&q=missing&severity=High&owner=Revenue%20Ops&entity=AESI&year=2025&month=December&quarter=Q4&dateFrom=2026-05-01&dateTo=2026-05-08&page=-5&pageSize=999',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.listIssueDocuments).toHaveBeenCalledWith({
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
      page: 1,
      pageSize: 25,
    })
    await expect(readJson(response)).resolves.toEqual({
      documents: [{ id: 'issue-1' }],
      pagination: {
        page: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      summary: {
        totalIssues: 1,
        reviewCount: 0,
        errorCount: 1,
        duplicateCount: 0,
      },
      filterOptions: {
        severities: ['High'],
        owners: ['Revenue Ops'],
        years: ['2025'],
        months: ['December'],
        quarters: ['Q4'],
      },
    })
  })

  it('passes entity id filters and lets entity id win over legacy entity text', async () => {
    const response = await issueDocumentsHandler({
      request: new Request(
        'http://localhost/api/documents/issues?entity=AESI&entityId=12&page=2',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.parseEntityFilterIdInput).toHaveBeenCalledWith('12')
    expect(mocks.listIssueDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: '',
        entityId: '12',
        page: 2,
      }),
    )
  })

  it('returns 400 for invalid direct entity id filters', async () => {
    mocks.parseEntityFilterIdInput.mockImplementation(() => {
      throw new Error('Invalid entity filter.')
    })

    const response = await issueDocumentsHandler({
      request: new Request(
        'http://localhost/api/documents/issues?entityId=bad',
      ),
    })

    expect(response.status).toBe(400)
    expect(mocks.listIssueDocuments).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Invalid entity filter.',
    })
  })
})
