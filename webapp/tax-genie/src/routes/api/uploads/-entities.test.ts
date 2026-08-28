import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  listUploadEntities: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/entities-server', () => ({
  listUploadEntities: mocks.listUploadEntities,
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

const { uploadEntitiesHandler } = await import('@/routes/api/uploads/entities')

const readJson = async (response: Response) => response.json()

describe('/api/uploads/entities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.listUploadEntities.mockResolvedValue([
      {
        id: 1,
        shortName: 'TMO',
        companyName: 'Therma Mobile Inc.',
        tin: '266-566-116-00000',
        tinPrefix: '266566116',
      },
    ])
  })

  it('returns 401 when unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await uploadEntitiesHandler({
      request: new Request('http://localhost/api/uploads/entities'),
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to view upload entities.',
    })
  })

  it('returns 403 when the user cannot upload', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await uploadEntitiesHandler({
      request: new Request('http://localhost/api/uploads/entities'),
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to upload source documents.',
    })
  })

  it('returns upload entity options', async () => {
    const response = await uploadEntitiesHandler({
      request: new Request('http://localhost/api/uploads/entities'),
    })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      entities: [
        {
          id: 1,
          shortName: 'TMO',
          companyName: 'Therma Mobile Inc.',
          tin: '266-566-116-00000',
          tinPrefix: '266566116',
        },
      ],
    })
  })
})
