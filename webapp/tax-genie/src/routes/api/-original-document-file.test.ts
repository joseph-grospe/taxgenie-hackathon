import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  canExportPdf: vi.fn(),
  getOriginalDocumentFileDownload: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
  canExport: {
    pdf: mocks.canExportPdf,
  },
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

const { originalDocumentFileHandler } =
  await import('@/routes/api/documents.$docId.original-file')

const readJson = async (response: Response) => response.json()

describe('/api/documents/$docId/original-file GET', () => {
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

    const response = await originalDocumentFileHandler({
      request: new Request(
        'http://localhost/api/documents/upload-1/original-file',
      ),
      params: { docId: 'upload-1' },
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to download original document files.',
    })
  })

  it('returns 403 when document access is not allowed', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await originalDocumentFileHandler({
      request: new Request(
        'http://localhost/api/documents/upload-1/original-file',
      ),
      params: { docId: 'upload-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to view document details.',
    })
  })

  it('returns 403 when PDF export is not allowed', async () => {
    mocks.canExportPdf.mockReturnValue(false)

    const response = await originalDocumentFileHandler({
      request: new Request(
        'http://localhost/api/documents/upload-1/original-file',
      ),
      params: { docId: 'upload-1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.canExportPdf).toHaveBeenCalledWith('editor', true)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to download original document files.',
    })
  })

  it('returns 404 when the original file is missing', async () => {
    mocks.getOriginalDocumentFileDownload.mockRejectedValue(
      new Error('Original file not found.'),
    )

    const response = await originalDocumentFileHandler({
      request: new Request(
        'http://localhost/api/documents/upload-1/original-file',
      ),
      params: { docId: 'upload-1' },
    })

    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Original file not found.',
    })
  })

  it('returns the original PDF attachment when available', async () => {
    mocks.getOriginalDocumentFileDownload.mockResolvedValue({
      bytes: Uint8Array.from([37, 80, 68, 70]),
      contentType: 'application/pdf',
      fileName: 'BIR2307_ACME_0426.pdf',
      sizeBytes: 1024,
    })

    const response = await originalDocumentFileHandler({
      request: new Request(
        'http://localhost/api/documents/upload-1/original-file',
      ),
      params: { docId: 'upload-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.getOriginalDocumentFileDownload).toHaveBeenCalledWith(
      'upload-1',
    )
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="BIR2307_ACME_0426.pdf"',
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from([37, 80, 68, 70]),
    )
  })
})
