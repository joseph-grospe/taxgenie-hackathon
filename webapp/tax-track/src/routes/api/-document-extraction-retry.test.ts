import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  logAuditEvent: vi.fn(),
  resolveContextFromRequest: vi.fn(),
  retryDocumentExtraction: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/audit', () => ({
  logAuditEvent: mocks.logAuditEvent,
}))

vi.mock('@/lib/extraction-retry-server', () => ({
  ExtractionRetryError: class ExtractionRetryError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message)
      this.name = 'ExtractionRetryError'
    }
  },
  retryDocumentExtraction: mocks.retryDocumentExtraction,
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
  parseJsonBodyWithDetails: async (
    request: Request,
    schema: { safeParse: (value: unknown) => unknown },
  ) => {
    const parsed = schema.safeParse(await request.json()) as {
      success: boolean
      data?: unknown
    }
    if (parsed.success) {
      return { ok: true, data: parsed.data }
    }
    return { ok: false, error: 'Invalid retry request.' }
  },
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { ExtractionRetryError } = await import('@/lib/extraction-retry-server')
const { handler } =
  await import('@/routes/api/documents.$docId.retry-extraction')

const uploadId = 'cf5f95d5-b974-407f-b05f-bdc62e7e0e5b'
const createRequest = (
  body: unknown = {
    sourceDocumentResultId: 38,
    sourceExtractionAttemptId: 104,
  },
) =>
  new Request(`http://localhost/api/documents/${uploadId}/retry-extraction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/documents/:uploadId/retry-extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'editor-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.retryDocumentExtraction.mockResolvedValue({
      uploadId,
      sourceDocumentResultId: 38,
      sourceExtractionAttemptId: 104,
      reasonCodes: ['gemini_http_503'],
      retryNumber: 1,
      revision: 'manual-retry-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      eventId: `${uploadId}:manual-retry-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
      status: 'queued',
    })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('requires authentication and upload-route access', async () => {
    mocks.resolveContextFromRequest.mockResolvedValueOnce(null)
    const unauthenticated = await handler({
      request: createRequest(),
      params: { docId: uploadId },
    })
    expect(unauthenticated.status).toBe(401)

    mocks.resolveContextFromRequest.mockResolvedValueOnce({
      userId: 'editor-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValueOnce(false)
    const forbidden = await handler({
      request: createRequest(),
      params: { docId: uploadId },
    })
    expect(forbidden.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('upload', 'editor')
    expect(mocks.retryDocumentExtraction).not.toHaveBeenCalled()
  })

  it('validates the source document result id', async () => {
    const response = await handler({
      request: createRequest({
        sourceDocumentResultId: '38',
        sourceExtractionAttemptId: 104,
      }),
      params: { docId: uploadId },
    })

    expect(response.status).toBe(400)
    expect(mocks.retryDocumentExtraction).not.toHaveBeenCalled()
  })

  it('returns a controlled retry conflict', async () => {
    mocks.retryDocumentExtraction.mockRejectedValueOnce(
      new ExtractionRetryError(
        'The document result changed. Refresh before retrying.',
        409,
      ),
    )

    const response = await handler({
      request: createRequest(),
      params: { docId: uploadId },
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'The document result changed. Refresh before retrying.',
    })
    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
  })

  it('queues a retry and records the immutable attempt transition', async () => {
    const request = createRequest()
    const response = await handler({
      request,
      params: { docId: uploadId },
    })

    expect(response.status).toBe(202)
    expect(mocks.retryDocumentExtraction).toHaveBeenCalledWith({
      uploadId,
      sourceDocumentResultId: 38,
      sourceExtractionAttemptId: 104,
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(request, {
      actorUserId: 'editor-1',
      eventType: 'document_extraction_retried',
      targetId: uploadId,
      targetType: 'document',
      metadata: {
        provider: 'gemini',
        failedDocumentResultId: 38,
        failedExtractionAttemptId: 104,
        retryNumber: 1,
        reasonCodes: ['gemini_http_503'],
        revision: 'manual-retry-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        eventId: `${uploadId}:manual-retry-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
      },
    })
    await expect(response.json()).resolves.toMatchObject({
      retry: {
        uploadId,
        retryNumber: 1,
        status: 'queued',
      },
    })
  })
})
