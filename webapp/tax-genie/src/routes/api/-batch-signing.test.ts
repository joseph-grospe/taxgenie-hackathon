import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  canSignCertificates: vi.fn(),
  getBatchSigningContext: vi.fn(),
  logAuditEvent: vi.fn(),
  resolveContextFromRequest: vi.fn(),
  signBatchCertificates: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  SIGNING_TEAM_REQUIRED_MESSAGE:
    'Only Tax Manager Team users can sign certificates.',
  canAccessRoute: mocks.canAccessRoute,
  canSignCertificates: mocks.canSignCertificates,
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
      email: 'user@example.com',
      role: 'editor',
      team: 'tax_manager',
      canExportPdf: false,
      canExportExcel: false,
      mustChangePassword: false,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canSignCertificates.mockImplementation(
      (context: { team?: string } | null | undefined) =>
        context?.team === 'tax_manager',
    )
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('returns signing context for an eligible owned upload batch', async () => {
    mocks.getBatchSigningContext.mockResolvedValue({
      documentId: 'batch-1',
      fileName: 'April withholding batch',
      certificateCount: 1,
      targets: [
        {
          certificateId: '42',
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

  it('returns newly successful unsigned targets when a signed batch is revisited', async () => {
    mocks.getBatchSigningContext.mockResolvedValue({
      documentId: 'batch-1',
      fileName: 'April withholding batch',
      certificateCount: 3,
      targets: [
        {
          certificateId: '42',
          fileName: 'cert-1.pdf',
          payee: 'Acme',
          certificatePageNumber: 1,
          sourcePdfUrl: '/api/s3-object?key=cert-1.pdf&bucket=results',
          signedPdfUrl: '/api/s3-object?key=signed-1.pdf&bucket=results',
          previewPageNumber: 1,
          templateKey: 'default-bir-2307',
          signingStatus: 'signed',
          signedAt: 'Apr 28, 2026, 10:00 AM',
          signedByName: 'Jane Doe',
          hasSavedTemplatePlacement: true,
          templatePlacement: {
            pageNumber: 1,
            signatureRect: { x: 0.5, y: 0.5, width: 0.2, height: 0.15 },
            nameRect: { x: 0.5, y: 0.6, width: 0.2, height: 0.03 },
            designationRect: { x: 0.5, y: 0.64, width: 0.2, height: 0.03 },
            tinRect: { x: 0.5, y: 0.68, width: 0.2, height: 0.03 },
          },
        },
        {
          certificateId: '43',
          fileName: 'cert-2.pdf',
          payee: 'Bravo',
          certificatePageNumber: 1,
          sourcePdfUrl: '/api/s3-object?key=cert-2.pdf&bucket=results',
          signedPdfUrl: '/api/s3-object?key=signed-2.pdf&bucket=results',
          previewPageNumber: 1,
          templateKey: 'default-bir-2307',
          signingStatus: 'signed',
          signedAt: 'Apr 28, 2026, 10:00 AM',
          signedByName: 'Jane Doe',
          hasSavedTemplatePlacement: true,
          templatePlacement: {
            pageNumber: 1,
            signatureRect: { x: 0.5, y: 0.5, width: 0.2, height: 0.15 },
            nameRect: { x: 0.5, y: 0.6, width: 0.2, height: 0.03 },
            designationRect: { x: 0.5, y: 0.64, width: 0.2, height: 0.03 },
            tinRect: { x: 0.5, y: 0.68, width: 0.2, height: 0.03 },
          },
        },
        {
          certificateId: '44',
          fileName: 'override-approved.pdf',
          payee: 'Charlie',
          certificatePageNumber: 1,
          sourcePdfUrl:
            '/api/s3-object?key=override-approved.pdf&bucket=results',
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
    await expect(readJson(response)).resolves.toEqual({
      signingContext: expect.objectContaining({
        certificateCount: 3,
        targets: expect.arrayContaining([
          expect.objectContaining({
            certificateId: '44',
            signingStatus: 'unsigned',
          }),
        ]),
      }),
    })
  })

  it('blocks context loading when the closed batch has no successful certificates', async () => {
    mocks.getBatchSigningContext.mockRejectedValue(
      new Error(
        'At least one active certificate in this batch must finish successfully before signing.',
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
        'At least one active certificate in this batch must finish successfully before signing.',
    })
  })

  it('rejects context loading for users outside Tax Manager Team', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      role: 'editor',
      team: 'tax_team',
      canExportPdf: false,
      canExportExcel: false,
      mustChangePassword: false,
    })

    const response = await batchSigningContextHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/signing-context',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.getBatchSigningContext).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Only Tax Manager Team users can sign certificates.',
    })
  })

  it('signs requested certificate targets through the batch route', async () => {
    mocks.signBatchCertificates.mockResolvedValue([
      {
        certificateId: '42',
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
            signingStartedAt: '2026-05-08T10:15:00.000Z',
            targets: [
              {
                certificateId: '42',
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
        signingStartedAt: '2026-05-08T10:15:00.000Z',
        targets: [expect.objectContaining({ certificateId: '42' })],
      }),
    )
    await expect(readJson(response)).resolves.toEqual({
      signedArtifacts: [expect.objectContaining({ certificateId: '42' })],
    })
  })

  it('rejects signing for users outside Tax Manager Team before signing work starts', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      role: 'editor',
      team: 'tax_team',
      canExportPdf: false,
      canExportExcel: false,
      mustChangePassword: false,
    })

    const response = await batchSignHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/sign',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        },
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.signBatchCertificates).not.toHaveBeenCalled()
    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Only Tax Manager Team users can sign certificates.',
    })
  })

  it('records explicit re-sign requests through the batch route', async () => {
    mocks.signBatchCertificates.mockResolvedValue([
      {
        certificateId: '42',
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
                certificateId: '42',
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
        targets: [expect.objectContaining({ certificateId: '42' })],
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
