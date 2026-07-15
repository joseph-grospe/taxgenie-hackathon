import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  listValidatedDocuments: vi.fn(),
  parseEntityFilterIdInput: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/documents-server', () => ({
  listValidatedDocuments: mocks.listValidatedDocuments,
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

const { validatedDocumentsHandler } =
  await import('@/routes/api/documents/validated')

const readJson = async (response: Response) => response.json()

describe('/api/documents/validated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.parseEntityFilterIdInput.mockReturnValue(null)
    mocks.listValidatedDocuments.mockResolvedValue({
      documents: [{ id: '1' }],
      pagination: {
        page: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      summary: {
        totalValidated: 1,
        certificateCount: 1,
        signedPdfCount: 0,
      },
      filterOptions: {
        year: ['2025'],
        month: ['December'],
        quarter: ['Q4'],
        customerType: ['BIR 2307'],
        errorType: ['None'],
        atc: ['WC160'],
      },
    })
  })

  it('requires authentication before listing validated documents', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await validatedDocumentsHandler({
      request: new Request('http://localhost/api/documents/validated'),
    })

    expect(response.status).toBe(401)
    expect(mocks.listValidatedDocuments).not.toHaveBeenCalled()
  })

  it('requires validated route access', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await validatedDocumentsHandler({
      request: new Request('http://localhost/api/documents/validated'),
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('validated', 'admin')
    expect(mocks.listValidatedDocuments).not.toHaveBeenCalled()
  })

  it('parses filters, sort, and pagination before calling the service', async () => {
    const response = await validatedDocumentsHandler({
      request: new Request(
        'http://localhost/api/documents/validated?entity=AESI&customerName=solar&quarter=Q4,Q3&atc=WC160&signingStatus=failed&sortBy=entity&sortDir=asc&page=-5&pageSize=999',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.listValidatedDocuments).toHaveBeenCalledWith({
      q: '',
      year: '',
      month: '',
      quarter: 'Q4,Q3',
      entity: 'AESI',
      entityId: '',
      customerType: '',
      customerName: 'solar',
      errorType: '',
      atc: 'WC160',
      signingStatus: 'failed',
      sortBy: 'entity',
      sortDir: 'asc',
      page: 1,
      pageSize: 25,
      actor: {
        role: 'admin',
        userId: 'admin-1',
      },
    })
    await expect(readJson(response)).resolves.toEqual({
      documents: [{ id: '1' }],
      pagination: {
        page: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      summary: {
        totalValidated: 1,
        certificateCount: 1,
        signedPdfCount: 0,
      },
      filterOptions: {
        year: ['2025'],
        month: ['December'],
        quarter: ['Q4'],
        customerType: ['BIR 2307'],
        errorType: ['None'],
        atc: ['WC160'],
      },
    })
  })

  it('passes entity id filters and lets entity id win over legacy entity text', async () => {
    const response = await validatedDocumentsHandler({
      request: new Request(
        'http://localhost/api/documents/validated?entity=AESI&entityId=12&page=2',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.parseEntityFilterIdInput).toHaveBeenCalledWith('12')
    expect(mocks.listValidatedDocuments).toHaveBeenCalledWith(
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

    const response = await validatedDocumentsHandler({
      request: new Request(
        'http://localhost/api/documents/validated?entityId=bad',
      ),
    })

    expect(response.status).toBe(400)
    expect(mocks.listValidatedDocuments).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Invalid entity filter.',
    })
  })
})
