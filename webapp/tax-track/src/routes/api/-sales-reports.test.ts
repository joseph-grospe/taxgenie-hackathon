import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route as SalesReportBatchRoute } from '@/routes/api/sales-reports.$reportId.batches.$batchId'
import { Route as SalesReportDetailRoute } from '@/routes/api/sales-reports.$reportId'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  canExportExcel: vi.fn(),
  deleteSalesReport: vi.fn(),
  exportSalesReportReconciliationReport: vi.fn(),
  getSalesReportDetail: vi.fn(),
  getSalesReportOriginalObject: vi.fn(),
  removeSalesReportBatch: vi.fn(),
  resolveContextFromRequest: vi.fn(),
  updateSalesReport: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
  canExport: {
    excel: mocks.canExportExcel,
  },
}))

vi.mock('@/lib/reconciliation-report-server', () => ({
  exportSalesReportReconciliationReport:
    mocks.exportSalesReportReconciliationReport,
}))

vi.mock('@/lib/sales-report-server', () => ({
  deleteSalesReport: mocks.deleteSalesReport,
  getSalesReportDetail: mocks.getSalesReportDetail,
  getSalesReportOriginalObject: mocks.getSalesReportOriginalObject,
  removeSalesReportBatch: mocks.removeSalesReportBatch,
  salesReportUpdateSchema: {},
  updateSalesReport: mocks.updateSalesReport,
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
  parseJsonBodyWithDetails: vi.fn(),
  resolveContextFromRequest: mocks.resolveContextFromRequest,
  unauthorizedResponse: (message = 'Forbidden') =>
    new Response(JSON.stringify({ error: message }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
}))

const readJson = async (response: Response) => response.json()
const salesReportBatchDeleteHandler =
  SalesReportBatchRoute.options.server.handlers.DELETE
const salesReportDetailGetHandler =
  SalesReportDetailRoute.options.server.handlers.GET

describe('/api/sales-reports/$reportId GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
      canExportExcel: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canExportExcel.mockReturnValue(true)
    mocks.getSalesReportDetail.mockResolvedValue({ id: 'report-1' })
  })

  it('passes parsed row and reconciliation result search params to the service', async () => {
    const response = await salesReportDetailGetHandler({
      request: new Request(
        'http://localhost/api/sales-reports/report-1?rowsQ=267-090&rowsPage=2&rowsPageSize=50&q=bravo&filter=unmatched&page=3&pageSize=100',
      ),
      params: { reportId: 'report-1' },
    })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      report: { id: 'report-1' },
    })
    expect(mocks.getSalesReportDetail).toHaveBeenCalledWith('report-1', {
      rowsQ: '267-090',
      rowsPage: 2,
      rowsPageSize: 50,
      q: 'bravo',
      filter: 'unmatched',
      resultsPage: 3,
      resultsPageSize: 100,
    })
  })

  it('keeps existing result pagination query names compatible', async () => {
    await salesReportDetailGetHandler({
      request: new Request(
        'http://localhost/api/sales-reports/report-1?page=2&pageSize=50&resultsPage=4&resultsPageSize=10',
      ),
      params: { reportId: 'report-1' },
    })

    expect(mocks.getSalesReportDetail).toHaveBeenCalledWith('report-1', {
      rowsQ: '',
      rowsPage: 1,
      rowsPageSize: 25,
      q: '',
      filter: 'all',
      resultsPage: 4,
      resultsPageSize: 10,
    })
  })

  it('returns the report-level reconciliation workbook attachment', async () => {
    mocks.exportSalesReportReconciliationReport.mockResolvedValue({
      fileName: 'Reconciliation-Report-EAUC-Sales-Report-All.xlsx',
      content: Buffer.from('excel-bytes'),
    })

    const response = await salesReportDetailGetHandler({
      request: new Request(
        'http://localhost/api/sales-reports/report-1?download=reconciliation',
      ),
      params: { reportId: 'report-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.exportSalesReportReconciliationReport).toHaveBeenCalledWith(
      'report-1',
    )
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Reconciliation-Report-EAUC-Sales-Report-All.xlsx"',
    )
    const content = Buffer.from(await response.arrayBuffer())
    expect(content.equals(Buffer.from('excel-bytes'))).toBe(true)
  })

  it('requires excel export access for report-level reconciliation workbooks', async () => {
    mocks.canExportExcel.mockReturnValue(false)

    const response = await salesReportDetailGetHandler({
      request: new Request(
        'http://localhost/api/sales-reports/report-1?download=reconciliation',
      ),
      params: { reportId: 'report-1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.exportSalesReportReconciliationReport).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to export reconciliation workbooks.',
    })
  })
})

describe('/api/sales-reports/$reportId/batches/$batchId DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.removeSalesReportBatch.mockResolvedValue({ id: 'report-1' })
  })

  it('requires authentication before removing a sales report batch', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await salesReportBatchDeleteHandler({
      request: new Request(
        'http://localhost/api/sales-reports/report-1/batches/batch-1',
        { method: 'DELETE' },
      ),
      params: { reportId: 'report-1', batchId: 'batch-1' },
    })

    expect(response.status).toBe(401)
    expect(mocks.removeSalesReportBatch).not.toHaveBeenCalled()
  })

  it('requires upload access before removing a sales report batch', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await salesReportBatchDeleteHandler({
      request: new Request(
        'http://localhost/api/sales-reports/report-1/batches/batch-1',
        { method: 'DELETE' },
      ),
      params: { reportId: 'report-1', batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.canAccessRoute).toHaveBeenCalledWith('upload', 'editor')
    expect(mocks.removeSalesReportBatch).not.toHaveBeenCalled()
  })

  it('returns the refreshed report after removing a batch', async () => {
    const response = await salesReportBatchDeleteHandler({
      request: new Request(
        'http://localhost/api/sales-reports/report-1/batches/batch-1',
        { method: 'DELETE' },
      ),
      params: { reportId: 'report-1', batchId: 'batch-1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.removeSalesReportBatch).toHaveBeenCalledWith({
      reportId: 'report-1',
      batchId: 'batch-1',
      userId: 'user-1',
    })
    await expect(readJson(response)).resolves.toEqual({
      report: { id: 'report-1' },
    })
  })

  it('returns 404 when the sales report does not exist', async () => {
    mocks.removeSalesReportBatch.mockResolvedValue(null)

    const response = await salesReportBatchDeleteHandler({
      request: new Request(
        'http://localhost/api/sales-reports/report-1/batches/batch-1',
        { method: 'DELETE' },
      ),
      params: { reportId: 'report-1', batchId: 'batch-1' },
    })

    expect(response.status).toBe(404)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Sales report not found.',
    })
  })

  it('returns 400 for service errors', async () => {
    mocks.removeSalesReportBatch.mockRejectedValue(
      new Error('Batch is not part of the active sales report run.'),
    )

    const response = await salesReportBatchDeleteHandler({
      request: new Request(
        'http://localhost/api/sales-reports/report-1/batches/batch-1',
        { method: 'DELETE' },
      ),
      params: { reportId: 'report-1', batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Batch is not part of the active sales report run.',
    })
  })
})
