import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  listDashboardEntities: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/dashboard-server', () => ({
  listDashboardEntities: mocks.listDashboardEntities,
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

const { dashboardEntitiesHandler } =
  await import('@/routes/api/dashboard/entities')

const readJson = async (response: Response) => response.json()

describe('/api/dashboard/entities GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.listDashboardEntities.mockResolvedValue([
      {
        id: 1,
        label: 'AESI - Aboitiz Energy Solutions, Inc.',
        shortName: 'AESI',
        companyName: 'Aboitiz Energy Solutions, Inc.',
        tin: '123456789000',
      },
    ])
  })

  it('returns 401 when unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await dashboardEntitiesHandler({
      request: new Request('http://localhost/api/dashboard/entities'),
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to view dashboard entities.',
    })
    expect(mocks.listDashboardEntities).not.toHaveBeenCalled()
  })

  it('returns 403 when dashboard access is denied', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await dashboardEntitiesHandler({
      request: new Request('http://localhost/api/dashboard/entities'),
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to view dashboard entities.',
    })
    expect(mocks.listDashboardEntities).not.toHaveBeenCalled()
  })

  it('returns full dashboard entity options', async () => {
    const response = await dashboardEntitiesHandler({
      request: new Request('http://localhost/api/dashboard/entities'),
    })

    expect(response.status).toBe(200)
    expect(mocks.listDashboardEntities).toHaveBeenCalledOnce()
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
