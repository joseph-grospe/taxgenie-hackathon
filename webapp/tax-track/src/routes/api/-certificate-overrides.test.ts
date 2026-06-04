import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CertificateOverrideServer from '@/lib/certificate-override-server'

const mocks = vi.hoisted(() => ({
  approveCertificateOverrideRequest: vi.fn(),
  canAccessRoute: vi.fn(),
  canRequestCertificateOverride: vi.fn(),
  createCertificateOverrideRequest: vi.fn(),
  listCertificateOverrideRequests: vi.fn(),
  logAuditEvent: vi.fn(),
  rejectCertificateOverrideRequest: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
  canRequestCertificateOverride: mocks.canRequestCertificateOverride,
}))

vi.mock('@/lib/audit', () => ({
  logAuditEvent: mocks.logAuditEvent,
}))

vi.mock('@/lib/certificate-override-server', async (importOriginal) => {
  const actual = await importOriginal<typeof CertificateOverrideServer>()

  return {
    ...actual,
    approveCertificateOverrideRequest: mocks.approveCertificateOverrideRequest,
    createCertificateOverrideRequest: mocks.createCertificateOverrideRequest,
    listCertificateOverrideRequests: mocks.listCertificateOverrideRequests,
    rejectCertificateOverrideRequest: mocks.rejectCertificateOverrideRequest,
  }
})

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
  parseJsonBodyWithDetails: async (
    request: Request,
    schema: { safeParse: (value: unknown) => unknown },
  ) => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return { ok: false, error: 'Invalid JSON payload.' }
    }

    const parsed = schema.safeParse(body) as
      | { success: true; data: unknown }
      | { success: false; error: { issues: Array<{ message: string }> } }

    return parsed.success
      ? { ok: true, data: parsed.data }
      : {
          ok: false,
          error: parsed.error.issues[0]?.message ?? 'Invalid payload.',
        }
  },
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { createCertificateOverrideRequestHandler } =
  await import('@/routes/api/certificate-overrides')
const { listCertificateOverrideRequestsHandler } =
  await import('@/routes/api/certificate-overrides')
const { approveCertificateOverrideRequestHandler } =
  await import('@/routes/api/certificate-overrides.$requestId.approve')
const { rejectCertificateOverrideRequestHandler } =
  await import('@/routes/api/certificate-overrides.$requestId.reject')

const readJson = async (response: Response) => response.json()

const createRequest = (body: unknown) =>
  new Request('http://localhost/api/certificate-overrides', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('/api/certificate-overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canRequestCertificateOverride.mockReturnValue(true)
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.createCertificateOverrideRequest.mockResolvedValue({
      id: 'override-1',
      documentResultId: 42,
      uploadId: 'upload-1',
      batchId: 'batch-1',
    })
    mocks.listCertificateOverrideRequests.mockResolvedValue({
      requests: [],
      summary: {
        pending: 0,
        approved: 0,
        rejected: 0,
      },
      pagination: {
        page: 1,
        pageSize: 25,
        totalItems: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })
    mocks.approveCertificateOverrideRequest.mockResolvedValue({
      requestId: 'override-1',
      documentResultId: 42,
      matchedCount: 1,
    })
    mocks.rejectCertificateOverrideRequest.mockResolvedValue({
      id: 'override-1',
      documentResultId: 42,
    })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('requires authentication before creating requests', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await createCertificateOverrideRequestHandler({
      request: createRequest({
        documentResultId: 42,
        requestNote: 'Business approved exception.',
      }),
    })

    expect(response.status).toBe(401)
    expect(mocks.createCertificateOverrideRequest).not.toHaveBeenCalled()
  })

  it('requires requester permission before creating requests', async () => {
    mocks.canRequestCertificateOverride.mockReturnValue(false)

    const response = await createCertificateOverrideRequestHandler({
      request: createRequest({
        documentResultId: 42,
        requestNote: 'Business approved exception.',
      }),
    })

    expect(response.status).toBe(403)
    expect(mocks.canRequestCertificateOverride).toHaveBeenCalledWith('editor')
    expect(mocks.createCertificateOverrideRequest).not.toHaveBeenCalled()
  })

  it('validates request payloads', async () => {
    const response = await createCertificateOverrideRequestHandler({
      request: createRequest({
        documentResultId: 42,
        requestNote: '',
      }),
    })

    expect(response.status).toBe(400)
    expect(mocks.createCertificateOverrideRequest).not.toHaveBeenCalled()
  })

  it('creates a pending request and logs an audit event', async () => {
    const request = createRequest({
      documentResultId: 42,
      requestNote: 'Business approved exception.',
    })

    const response = await createCertificateOverrideRequestHandler({ request })

    expect(response.status).toBe(201)
    expect(mocks.createCertificateOverrideRequest).toHaveBeenCalledWith({
      documentResultId: 42,
      requestNote: 'Business approved exception.',
      userId: 'user-1',
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'certificate_override_requested',
        actorUserId: 'user-1',
        targetId: '42',
        targetType: 'document',
      }),
    )
  })

  it('returns service duplicate-pending failures as bad requests', async () => {
    mocks.createCertificateOverrideRequest.mockRejectedValue(
      new Error(
        'This certificate already has a pending or approved override request.',
      ),
    )

    const response = await createCertificateOverrideRequestHandler({
      request: createRequest({
        documentResultId: 42,
        requestNote: 'Business approved exception.',
      }),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error:
        'This certificate already has a pending or approved override request.',
    })
  })

  it('requires admin access before listing requests', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await listCertificateOverrideRequestsHandler({
      request: new Request(
        'http://localhost/api/certificate-overrides?status=pending',
      ),
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith(
      'overrideRequests',
      'editor',
    )
    expect(mocks.listCertificateOverrideRequests).not.toHaveBeenCalled()
  })

  it('lists override requests with status filters', async () => {
    const response = await listCertificateOverrideRequestsHandler({
      request: new Request(
        'http://localhost/api/certificate-overrides?status=all',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.listCertificateOverrideRequests).toHaveBeenCalledWith({
      status: 'all',
      q: '',
      page: 1,
      pageSize: 25,
    })
  })

  it('passes search and pagination filters to the list service', async () => {
    const response = await listCertificateOverrideRequestsHandler({
      request: new Request(
        'http://localhost/api/certificate-overrides?status=approved&q=Acme%20TIN&page=3&pageSize=50',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.listCertificateOverrideRequests).toHaveBeenCalledWith({
      status: 'approved',
      q: 'Acme TIN',
      page: 3,
      pageSize: 50,
    })
  })

  it('normalizes invalid page parameters before listing requests', async () => {
    const response = await listCertificateOverrideRequestsHandler({
      request: new Request(
        'http://localhost/api/certificate-overrides?status=pending&page=-2&pageSize=999',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.listCertificateOverrideRequests).toHaveBeenCalledWith({
      status: 'pending',
      q: '',
      page: 1,
      pageSize: 25,
    })
  })
})

describe('/api/certificate-overrides/$requestId decision routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.approveCertificateOverrideRequest.mockResolvedValue({
      requestId: 'override-1',
      documentResultId: 42,
      matchedCount: 1,
    })
    mocks.rejectCertificateOverrideRequest.mockResolvedValue({
      id: 'override-1',
      documentResultId: 42,
    })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('rejects self-approval service failures', async () => {
    mocks.approveCertificateOverrideRequest.mockRejectedValue(
      new Error('You cannot approve your own override request.'),
    )

    const response = await approveCertificateOverrideRequestHandler({
      request: createRequest({ decisionNote: 'Reviewed and approved.' }),
      params: { requestId: 'override-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You cannot approve your own override request.',
    })
  })

  it('approves a pending request and logs an audit event', async () => {
    const request = createRequest({ decisionNote: 'Reviewed and approved.' })
    const response = await approveCertificateOverrideRequestHandler({
      request,
      params: { requestId: 'override-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.approveCertificateOverrideRequest).toHaveBeenCalledWith({
      requestId: 'override-1',
      userId: 'admin-1',
      decisionNote: 'Reviewed and approved.',
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'certificate_override_approved',
        actorUserId: 'admin-1',
        targetId: '42',
        targetType: 'document',
      }),
    )
  })

  it('rejects a pending request and logs an audit event', async () => {
    const request = createRequest({ decisionNote: 'Insufficient support.' })
    const response = await rejectCertificateOverrideRequestHandler({
      request,
      params: { requestId: 'override-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.rejectCertificateOverrideRequest).toHaveBeenCalledWith({
      requestId: 'override-1',
      userId: 'admin-1',
      decisionNote: 'Insufficient support.',
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        eventType: 'certificate_override_rejected',
        actorUserId: 'admin-1',
        targetId: '42',
        targetType: 'document',
      }),
    )
  })
})
