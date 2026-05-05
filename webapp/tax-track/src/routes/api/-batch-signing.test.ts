import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  getBatchSigningContext: vi.fn(),
  logAuditEvent: vi.fn(),
  resolveContextFromRequest: vi.fn(),
  signBatchCertificates: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/audit', () => ({
  logAuditEvent: mocks.logAuditEvent,
}))

vi.mock('@/lib/signing-server', () => ({
  getBatchSigningContext: mocks.getBatchSigningContext,
  signBatchCertificates: mocks.signBatchCertificates,
}))

vi.mock('@/lib/user-admin-server', () => ({
  badRequestResponse: (message = 'Bad request') =>
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
    schema: {
      safeParse: (value: unknown) => { success: boolean; data?: unknown }
    },
  ) => {
    const parsed = schema.safeParse(await request.json().catch(() => null))

    return parsed.success
      ? { ok: true as const, data: parsed.data }
      : { ok: false as const, error: 'Invalid request body.' }
  },
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { batchSigningContextHandler } =
  await import('@/routes/api/uploads/batches.$batchId.signing-context')
const { batchSignHandler } =
  await import('@/routes/api/uploads/batches.$batchId.sign')

const readJson = async (response: Response) => response.json()

describe('batch signing API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('returns signing context for an eligible owned upload batch', async () => {
    mocks.getBatchSigningContext.mockResolvedValue({
      documentId: 'batch-1',
      fileName: 'April withholding batch',
      certificateCount: 1,
      targets: [
        {
          documentResultId: '42',
          fileName: 'cert.pdf',
          payee: 'Acme',
          certificatePageNumber: 1,
          sourcePdfUrl: '/api/s3-object?key=cert.pdf&bucket=results',
          previewPageNumber: 1,
          templateKey: 'default-bir-2307',
          signingStatus: 'unsigned',
          hasSavedTemplatePlacement: false,
          templatePlacement: null,
        },
      ],
      signatureProfile: null,
    })

    const response = await batchSigningContextHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/signing-context',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.getBatchSigningContext).toHaveBeenCalledWith(
      'batch-1',
      'user-1',
    )
    await expect(readJson(response)).resolves.toEqual({
      signingContext: expect.objectContaining({
        documentId: 'batch-1',
        fileName: 'April withholding batch',
        certificateCount: 1,
      }),
    })
  })

  it('blocks context loading while the closed batch still has active work', async () => {
    mocks.getBatchSigningContext.mockRejectedValue(
      new Error(
        'Wait for all pending, uploaded, queued, or processing files to finish before signing this batch.',
      ),
    )

    const response = await batchSigningContextHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/signing-context',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error:
        'Wait for all pending, uploaded, queued, or processing files to finish before signing this batch.',
    })
  })

  it('signs requested certificate targets through the batch route', async () => {
    mocks.signBatchCertificates.mockResolvedValue([
      {
        documentResultId: '42',
        status: 'signed',
        signedAt: 'Apr 28, 2026, 10:00 AM',
        signedPdfUrl: '/api/s3-object?key=signed.pdf&bucket=results',
      },
    ])

    const response = await batchSignHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/sign',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            targets: [
              {
                documentResultId: '42',
                pageNumber: 1,
                signatureRect: {
                  x: 0.5,
                  y: 0.5,
                  width: 0.2,
                  height: 0.15,
                },
              },
            ],
          }),
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.signBatchCertificates).toHaveBeenCalledWith(
      'batch-1',
      'user-1',
      expect.objectContaining({
        targets: [expect.objectContaining({ documentResultId: '42' })],
      }),
    )
    await expect(readJson(response)).resolves.toEqual({
      signedArtifacts: [expect.objectContaining({ documentResultId: '42' })],
    })
  })

  it('records explicit re-sign requests through the batch route', async () => {
    mocks.signBatchCertificates.mockResolvedValue([
      {
        documentResultId: '42',
        status: 'signed',
        signedAt: 'Apr 28, 2026, 10:15 AM',
        signedPdfUrl: '/api/s3-object?key=resigned.pdf&bucket=results',
      },
    ])

    const response = await batchSignHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/sign',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            resign: true,
            targets: [
              {
                documentResultId: '42',
                pageNumber: 1,
                signatureRect: {
                  x: 0.5,
                  y: 0.5,
                  width: 0.2,
                  height: 0.15,
                },
              },
            ],
          }),
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.signBatchCertificates).toHaveBeenCalledWith(
      'batch-1',
      'user-1',
      expect.objectContaining({
        resign: true,
        targets: [expect.objectContaining({ documentResultId: '42' })],
      }),
    )
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        eventType: 'certificate_resigned',
        targetId: 'batch-1',
        targetType: 'batch',
        metadata: expect.objectContaining({
          resigned: true,
          signedCount: 1,
        }),
      }),
    )
  })
})
