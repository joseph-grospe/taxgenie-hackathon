import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  canExportPdf: vi.fn(),
  getIssueFilesZipDownload: vi.fn(),
  listIssueDocuments: vi.fn(),
  logAuditEvent: vi.fn(),
  parseEntityFilterIdInput: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

const toLimitMessage = (limit: number) =>
  `Download is limited to ${limit} files. Narrow the Issues Queue filters and try again.`

const toSizeLimitMessage = (limitLabel: string) =>
  `Download is limited to ${limitLabel}. Narrow the Issues Queue filters and try again.`

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
  canExport: {
    pdf: mocks.canExportPdf,
  },
}))

vi.mock('@/lib/audit', () => ({
  logAuditEvent: mocks.logAuditEvent,
}))

vi.mock('@/lib/documents-server', () => ({
  listIssueDocuments: mocks.listIssueDocuments,
}))

vi.mock('@/lib/entities-server', () => ({
  parseEntityFilterIdInput: mocks.parseEntityFilterIdInput,
}))

vi.mock('@/lib/issue-files-server', () => ({
  ISSUE_FILE_DOWNLOAD_FALLBACK_FILE_NAME: 'Issue-Files.zip',
  ISSUE_FILE_DOWNLOAD_MAX_FILES: 50,
  ISSUE_FILE_DOWNLOAD_MAX_SIZE_LABEL: '200 MiB',
  getIssueFilesZipDownload: mocks.getIssueFilesZipDownload,
  toIssueFileDownloadLimitMessage: toLimitMessage,
  toIssueFileDownloadSizeLimitMessage: toSizeLimitMessage,
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
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { issueDocumentFilesHandler } =
  await import('@/routes/api/documents/issues.files')

const readJson = async (response: Response) => response.json()

describe('/api/documents/issues/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'editor-1',
      role: 'editor',
      canExportPdf: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canExportPdf.mockReturnValue(true)
    mocks.parseEntityFilterIdInput.mockReturnValue(null)
    mocks.getIssueFilesZipDownload.mockResolvedValue({
      fileName: 'Issue-Files-20260518-100000.zip',
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'application/zip',
      fileCount: 2,
      totalSizeBytes: 2048,
    })
    mocks.logAuditEvent.mockResolvedValue(undefined)
  })

  it('requires authentication before downloading issue files', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await issueDocumentFilesHandler({
      request: new Request('http://localhost/api/documents/issues/files'),
    })

    expect(response.status).toBe(401)
    expect(mocks.getIssueFilesZipDownload).not.toHaveBeenCalled()
  })

  it('requires issues route access', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await issueDocumentFilesHandler({
      request: new Request('http://localhost/api/documents/issues/files'),
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('issues', 'editor')
    expect(mocks.getIssueFilesZipDownload).not.toHaveBeenCalled()
  })

  it('requires PDF export permission after route access', async () => {
    mocks.canExportPdf.mockReturnValue(false)

    const response = await issueDocumentFilesHandler({
      request: new Request('http://localhost/api/documents/issues/files'),
    })

    expect(response.status).toBe(403)
    expect(mocks.canExportPdf).toHaveBeenCalledWith('editor', true)
    expect(mocks.getIssueFilesZipDownload).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid direct entity id filters', async () => {
    mocks.parseEntityFilterIdInput.mockImplementation(() => {
      throw new Error('Invalid entity filter.')
    })

    const response = await issueDocumentFilesHandler({
      request: new Request(
        'http://localhost/api/documents/issues/files?entityId=bad',
      ),
    })

    expect(response.status).toBe(400)
    expect(mocks.getIssueFilesZipDownload).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Invalid entity filter.',
    })
  })

  it('downloads filtered issue files as a zip and logs the export', async () => {
    const request = new Request(
      'http://localhost/api/documents/issues/files?status=duplicate&q=missing&severity=High&owner=Revenue%20Ops&entity=AESI&year=2025&month=December&quarter=Q4&dateFrom=2026-05-01&dateTo=2026-05-08&page=4&pageSize=100',
    )

    const response = await issueDocumentFilesHandler({ request })

    expect(response.status).toBe(200)
    expect(mocks.getIssueFilesZipDownload).toHaveBeenCalledWith({
      status: 'duplicate',
      q: 'missing',
      severity: 'High',
      owner: 'Revenue Ops',
      entity: 'AESI',
      entityId: '',
      year: '2025',
      month: 'December',
      quarter: 'Q4',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-08',
    })
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(request, {
      actorUserId: 'editor-1',
      eventType: 'issues_exported',
      metadata: {
        format: 'zip',
        filters: {
          status: 'duplicate',
          q: 'missing',
          severity: 'High',
          owner: 'Revenue Ops',
          entity: 'AESI',
          entityId: null,
          year: '2025',
          month: 'December',
          quarter: 'Q4',
          dateFrom: '2026-05-01',
          dateTo: '2026-05-08',
        },
        fileCount: 2,
        totalSizeBytes: 2048,
      },
    })
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Issue-Files-20260518-100000.zip"',
    )
    expect(
      Buffer.from(await response.arrayBuffer()).equals(Buffer.from([1, 2, 3])),
    ).toBe(true)
  })

  it('blocks over-limit issue file downloads without logging', async () => {
    mocks.getIssueFilesZipDownload.mockRejectedValue(
      new Error(toLimitMessage(50)),
    )

    const response = await issueDocumentFilesHandler({
      request: new Request('http://localhost/api/documents/issues/files'),
    })

    expect(response.status).toBe(400)
    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: toLimitMessage(50),
    })
  })
})
