import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  canExportExcel: vi.fn(),
  exportBatchBir2307Report: vi.fn(),
  getUploadBatchById: vi.fn(),
  resolveContextFromRequest: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
  canExport: {
    excel: mocks.canExportExcel,
  },
}))

vi.mock('@/lib/bir2307-export-server', () => ({
  exportBatchBir2307Report: mocks.exportBatchBir2307Report,
}))

vi.mock('@/lib/intake-server', () => ({
  getUploadBatchById: mocks.getUploadBatchById,
}))

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
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { batchBir2307ExportHandler } =
  await import('@/routes/api/uploads/batches.$batchId.bir2307.export')

const readJson = async (response: Response) => response.json()
const buildRequest = () =>
  new Request('http://localhost/api/uploads/batches/batch-1/bir2307/export')

const buildBatchResult = (status: 'open' | 'closed' = 'closed') => ({
  status: 'ok',
  batch: {
    id: 'batch-1',
    status,
  },
})

describe('/api/uploads/batches/$batchId/bir2307/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
      canExportExcel: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canExportExcel.mockReturnValue(true)
    mocks.getUploadBatchById.mockResolvedValue(buildBatchResult())
    mocks.exportBatchBir2307Report.mockResolvedValue({
      fileName: 'BIR-2307-Export-Batch-batch-1.xlsx',
      content: Buffer.from('excel-bytes'),
    })
  })

  it('returns 401 when unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await batchBir2307ExportHandler({
      request: buildRequest(),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to export extracted 2307 data.',
    })
  })

  it('returns 403 when the role cannot access upload routes', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await batchBir2307ExportHandler({
      request: buildRequest(),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to export extracted 2307 data.',
    })
  })

  it('returns 403 when excel export is not allowed', async () => {
    mocks.canExportExcel.mockReturnValue(false)

    const response = await batchBir2307ExportHandler({
      request: buildRequest(),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to export 2307 workbooks.',
    })
  })

  it('returns 404 when the batch is missing', async () => {
    mocks.getUploadBatchById.mockResolvedValue({
      status: 'not_found',
      batch: null,
    })

    const response = await batchBir2307ExportHandler({
      request: buildRequest(),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Upload batch not found.',
    })
  })

  it('returns 403 when the batch is forbidden', async () => {
    mocks.getUploadBatchById.mockResolvedValue({
      status: 'forbidden',
      batch: null,
    })

    const response = await batchBir2307ExportHandler({
      request: buildRequest(),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to export this upload batch.',
    })
  })

  it('returns 400 while the batch is open', async () => {
    mocks.getUploadBatchById.mockResolvedValue(buildBatchResult('open'))

    const response = await batchBir2307ExportHandler({
      request: buildRequest(),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Close this upload batch before exporting extracted 2307 data.',
    })
  })

  it('returns 400 when no extracted rows exist', async () => {
    mocks.exportBatchBir2307Report.mockRejectedValue(
      new Error('No extracted 2307 rows found for this upload batch.'),
    )

    const response = await batchBir2307ExportHandler({
      request: buildRequest(),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'No extracted 2307 rows found for this upload batch.',
    })
  })

  it('returns the workbook attachment when export succeeds', async () => {
    const response = await batchBir2307ExportHandler({
      request: buildRequest(),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="BIR-2307-Export-Batch-batch-1.xlsx"',
    )
    const content = Buffer.from(await response.arrayBuffer())
    expect(content.equals(Buffer.from('excel-bytes'))).toBe(true)
  })
})
