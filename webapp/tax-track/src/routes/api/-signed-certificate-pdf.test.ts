import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  canExportPdf: vi.fn(),
  getSignedCertificatePdfDownload: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
  canExport: {
    pdf: mocks.canExportPdf,
  },
}))

vi.mock('@/lib/signing-server', () => ({
  getSignedCertificatePdfDownload: mocks.getSignedCertificatePdfDownload,
}))

vi.mock('@/lib/user-admin-server', () => ({
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

const { signedCertificatePdfHandler } =
  await import('@/routes/api/documents.$docId.signed-pdf')

const readJson = async (response: Response) => response.json()

describe('/api/documents/$docId/signed-pdf GET', () => {
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

    const response = await signedCertificatePdfHandler({
      request: new Request('http://localhost/api/documents/42/signed-pdf'),
      params: { docId: '42' },
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to download signed certificates.',
    })
  })

  it('returns 403 when document access is not allowed', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await signedCertificatePdfHandler({
      request: new Request('http://localhost/api/documents/42/signed-pdf'),
      params: { docId: '42' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to view document details.',
    })
  })

  it('returns 403 when PDF export is not allowed', async () => {
    mocks.canExportPdf.mockReturnValue(false)

    const response = await signedCertificatePdfHandler({
      request: new Request('http://localhost/api/documents/42/signed-pdf'),
      params: { docId: '42' },
    })

    expect(response.status).toBe(403)
    expect(mocks.canExportPdf).toHaveBeenCalledWith('editor', true)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to download signed certificate PDFs.',
    })
  })

  it('returns 404 when the signed artifact is missing', async () => {
    mocks.getSignedCertificatePdfDownload.mockRejectedValue(
      new Error('Signed PDF is not available for this certificate.'),
    )

    const response = await signedCertificatePdfHandler({
      request: new Request('http://localhost/api/documents/42/signed-pdf'),
      params: { docId: '42' },
    })

    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Signed PDF is not available for this certificate.',
    })
  })

  it('returns the signed PDF attachment when available', async () => {
    mocks.getSignedCertificatePdfDownload.mockResolvedValue({
      bytes: Uint8Array.from([37, 80, 68, 70]),
      contentType: 'application/pdf',
      fileName: 'BIR2307_ACME_FINAL_0426.pdf',
    })

    const response = await signedCertificatePdfHandler({
      request: new Request('http://localhost/api/documents/42/signed-pdf'),
      params: { docId: '42' },
    })

    expect(response.status).toBe(200)
    expect(mocks.getSignedCertificatePdfDownload).toHaveBeenCalledWith(
      '42',
      'user-1',
    )
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="BIR2307_ACME_FINAL_0426.pdf"',
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from([37, 80, 68, 70]),
    )
  })
})
