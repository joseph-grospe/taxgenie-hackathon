import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  canExportPdf: vi.fn(),
  getSignedBatchCertificatesZipDownload: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
  canExport: {
    pdf: mocks.canExportPdf,
  },
}))

vi.mock('@/lib/signing-server', () => ({
  getSignedBatchCertificatesZipDownload:
    mocks.getSignedBatchCertificatesZipDownload,
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
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { signedBatchCertificatesExportHandler } =
  await import('@/routes/api/uploads/batches.$batchId.signed-certificates.export')

const readJson = async (response: Response) => response.json()

describe('/api/uploads/batches/$batchId/signed-certificates/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
      canExportPdf: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canExportPdf.mockReturnValue(true)
  })

  it('returns 401 when the request is unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await signedBatchCertificatesExportHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/signed-certificates/export',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to download signed certificates.',
    })
  })

  it('returns 403 when batch or document visibility is not allowed', async () => {
    mocks.canAccessRoute.mockImplementation(
      (route: string) => route !== 'batches',
    )

    const response = await signedBatchCertificatesExportHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/signed-certificates/export',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to view signed certificates.',
    })
  })

  it('returns 403 when PDF export is not allowed', async () => {
    mocks.canExportPdf.mockReturnValue(false)

    const response = await signedBatchCertificatesExportHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/signed-certificates/export',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.canExportPdf).toHaveBeenCalledWith('editor', true)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to download signed certificate PDFs.',
    })
  })

  it('returns 400 for non-closed batches', async () => {
    mocks.getSignedBatchCertificatesZipDownload.mockRejectedValue(
      new Error(
        'Close this upload batch before downloading signed certificates.',
      ),
    )

    const response = await signedBatchCertificatesExportHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/signed-certificates/export',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Close this upload batch before downloading signed certificates.',
    })
  })

  it('returns 404 when no signed certificates are available', async () => {
    mocks.getSignedBatchCertificatesZipDownload.mockRejectedValue(
      new Error('No signed certificate PDFs were found for this batch.'),
    )

    const response = await signedBatchCertificatesExportHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/signed-certificates/export',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'No signed certificate PDFs were found for this batch.',
    })
  })

  it('returns the signed certificate zip attachment when available', async () => {
    mocks.getSignedBatchCertificatesZipDownload.mockResolvedValue({
      bytes: Uint8Array.from([80, 75, 3, 4]),
      contentType: 'application/zip',
      fileName: 'Signed-Certificates-April Batch.zip',
      signedCount: 2,
    })

    const response = await signedBatchCertificatesExportHandler({
      request: new Request(
        'http://localhost/api/uploads/batches/batch-1/signed-certificates/export',
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.getSignedBatchCertificatesZipDownload).toHaveBeenCalledWith({
      batchId: 'batch-1',
      downloaderUserId: 'user-1',
    })
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Signed-Certificates-April Batch.zip"',
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from([80, 75, 3, 4]),
    )
  })
})
