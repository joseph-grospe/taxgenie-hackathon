import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessPath: vi.fn(),
  listEntityScopeOptions: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessPath: mocks.canAccessPath,
}))

vi.mock('@/lib/entities-server', () => ({
  listEntityScopeOptions: mocks.listEntityScopeOptions,
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

const { entitiesHandler } = await import('@/routes/api/entities')

const readJson = async (response: Response) => response.json()

describe('/api/entities GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'viewer',
    })
    mocks.canAccessPath.mockReturnValue(true)
    mocks.listEntityScopeOptions.mockResolvedValue([
      {
        id: 1,
        label: 'AESI - Aboitiz Energy Solutions, Inc.',
        shortName: 'AESI',
        companyName: 'Aboitiz Energy Solutions, Inc.',
        tin: '123456789000',
      },
    ])
  })

  it('requires authentication', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await entitiesHandler({
      request: new Request('http://localhost/api/entities'),
    })

    expect(response.status).toBe(401)
    expect(mocks.listEntityScopeOptions).not.toHaveBeenCalled()
  })

  it('requires dashboard-level application access', async () => {
    mocks.canAccessPath.mockReturnValue(false)

    const response = await entitiesHandler({
      request: new Request('http://localhost/api/entities'),
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessPath).toHaveBeenCalledWith('/dashboard', 'viewer')
    expect(mocks.listEntityScopeOptions).not.toHaveBeenCalled()
  })

  it('returns full entity scope options', async () => {
    const response = await entitiesHandler({
      request: new Request('http://localhost/api/entities'),
    })

    expect(response.status).toBe(200)
    expect(mocks.listEntityScopeOptions).toHaveBeenCalledOnce()
    await expect(readJson(response)).resolves.toEqual({
      entities: [
        {
          id: 1,
          label: 'AESI - Aboitiz Energy Solutions, Inc.',
          shortName: 'AESI',
          companyName: 'Aboitiz Energy Solutions, Inc.',
          tin: '123456789000',
        },
      ],
    })
  })
})
