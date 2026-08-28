import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  getOriginalDocumentFileDownload: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/issue-files-server', () => ({
  getOriginalDocumentFileDownload: mocks.getOriginalDocumentFileDownload,
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

const { originalDocumentPreviewHandler } =
  await import('@/routes/api/documents.$docId.original-preview')

const readJson = async (response: Response) => response.json()

describe('/api/documents/$docId/original-preview GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'viewer',
      canExportPdf: false,
    })
    mocks.canAccessRoute.mockReturnValue(true)
  })

  it('returns 401 when the request is unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await originalDocumentPreviewHandler({
      request: new Request(
        'http://localhost/api/documents/upload-1/original-preview',
      ),
      params: { docId: 'upload-1' },
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to preview original document files.',
    })
  })

  it('returns 403 when document access is not allowed', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await originalDocumentPreviewHandler({
      request: new Request(
        'http://localhost/api/documents/upload-1/original-preview',
      ),
      params: { docId: 'upload-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to view document details.',
    })
  })

  it.each(['Document not found.', 'Original file not found.'])(
    'returns 404 when lookup fails with "%s"',
    async (message) => {
      mocks.getOriginalDocumentFileDownload.mockRejectedValue(
        new Error(message),
      )

      const response = await originalDocumentPreviewHandler({
        request: new Request(
          'http://localhost/api/documents/upload-1/original-preview',
        ),
        params: { docId: 'upload-1' },
      })

      expect(response.status).toBe(404)
      await expect(readJson(response)).resolves.toEqual({ error: message })
    },
  )

  it('returns the original PDF inline without requiring export permission', async () => {
    mocks.getOriginalDocumentFileDownload.mockResolvedValue({
      bytes: Uint8Array.from([37, 80, 68, 70]),
      contentType: 'application/pdf',
      fileName: 'BIR2307_"ACME".pdf',
      sizeBytes: 1024,
    })

    const response = await originalDocumentPreviewHandler({
      request: new Request(
        'http://localhost/api/documents/upload-1/original-preview',
      ),
      params: { docId: 'upload-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.getOriginalDocumentFileDownload).toHaveBeenCalledWith(
      'upload-1',
    )
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-disposition')).toBe(
      'inline; filename="BIR2307__ACME_.pdf"',
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from([37, 80, 68, 70]),
    )
  })

  it('returns 500 for unexpected storage failures', async () => {
    mocks.getOriginalDocumentFileDownload.mockRejectedValue(
      new Error('Storage unavailable.'),
    )

    const response = await originalDocumentPreviewHandler({
      request: new Request(
        'http://localhost/api/documents/upload-1/original-preview',
      ),
      params: { docId: 'upload-1' },
    })

    expect(response.status).toBe(500)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Storage unavailable.',
    })
  })
})
