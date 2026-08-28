import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDevDataResetStatus: vi.fn(),
  isDevDataResetAvailable: vi.fn(),
  logAuditEvent: vi.fn(),
  resetDevData: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({
  logAuditEvent: mocks.logAuditEvent,
}))

vi.mock('@/lib/dev-data-reset-server', () => ({
  DEV_DATA_RESET_CONFIRMATION: 'CLEAR DEV DATA',
  getDevDataResetStatus: mocks.getDevDataResetStatus,
  isDevDataResetAvailable: mocks.isDevDataResetAvailable,
  resetDevData: mocks.resetDevData,
}))

vi.mock('@/lib/user-admin-server', () => ({
  badRequestResponse: (message: string) =>
    new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
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
  parseJsonBodyWithDetails: async (
    request: Request,
    schema: {
      safeParse: (body: unknown) =>
        | { success: true; data: unknown }
        | { success: false; error: { issues: Array<{ message?: string }> } }
    },
  ) => {
    const body = await request.json().catch(() => null)
    const parsed = schema.safeParse(body)

    return parsed.success
      ? { ok: true as const, data: parsed.data }
      : {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? 'Invalid request payload.',
        }
  },
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { devDataResetHandler, devDataResetStatusHandler } = await import(
  '@/routes/api/dev/data-reset'
)

const readJson = async (response: Response) => response.json()

describe('/api/dev/data-reset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isDevDataResetAvailable.mockReturnValue(true)
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.getDevDataResetStatus.mockResolvedValue({
      available: true,
      stage: 'dev-app',
      counts: {
        intake_files: 2,
      },
    })
    mocks.resetDevData.mockResolvedValue({
      stage: 'dev-app',
      resetAt: '2026-05-05T00:00:00.000Z',
      deletedCounts: {
        intake_files: 2,
      },
    })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('returns 404 without auth or DB work outside dev environments', async () => {
    mocks.isDevDataResetAvailable.mockReturnValue(false)

    const response = await devDataResetStatusHandler({
      request: new Request('http://localhost/api/dev/data-reset'),
    })

    expect(response.status).toBe(404)
    expect(mocks.resolveContextFromRequest).not.toHaveBeenCalled()
    expect(mocks.getDevDataResetStatus).not.toHaveBeenCalled()
  })

  it('returns reset status for admins in dev environments', async () => {
    const response = await devDataResetStatusHandler({
      request: new Request('http://localhost/api/dev/data-reset'),
    })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      available: true,
      stage: 'dev-app',
      counts: {
        intake_files: 2,
      },
    })
  })

  it('blocks non-admin users in dev environments', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'editor-1',
      role: 'editor',
    })

    const response = await devDataResetHandler({
      request: new Request('http://localhost/api/dev/data-reset', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'CLEAR DEV DATA' }),
      }),
    })

    expect(response.status).toBe(403)
    expect(mocks.resetDevData).not.toHaveBeenCalled()
  })

  it('rejects missing confirmation text', async () => {
    const response = await devDataResetHandler({
      request: new Request('http://localhost/api/dev/data-reset', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'clear' }),
      }),
    })

    expect(response.status).toBe(400)
    expect(mocks.resetDevData).not.toHaveBeenCalled()
  })

  it('clears data and logs an audit event after confirmation', async () => {
    const request = new Request('http://localhost/api/dev/data-reset', {
      method: 'POST',
      body: JSON.stringify({ confirmation: 'CLEAR DEV DATA' }),
    })

    const response = await devDataResetHandler({ request })

    expect(response.status).toBe(200)
    expect(mocks.resetDevData).toHaveBeenCalledTimes(1)
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(request, {
      eventType: 'dev_data_reset',
      actorUserId: 'admin-1',
      metadata: {
        stage: 'dev-app',
        resetAt: '2026-05-05T00:00:00.000Z',
        deletedCounts: {
          intake_files: 2,
        },
      },
    })
    await expect(readJson(response)).resolves.toEqual({
      stage: 'dev-app',
      resetAt: '2026-05-05T00:00:00.000Z',
      deletedCounts: {
        intake_files: 2,
      },
    })
  })
})
