import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route as SalesReportDetailRoute } from '@/routes/api/sales-reports.$reportId'

const mocks = vi.hoisted(() => ({
  canAccessRoute: vi.fn(),
  deleteSalesReport: vi.fn(),
  getSalesReportDetail: vi.fn(),
  getSalesReportOriginalObject: vi.fn(),
  resolveContextFromRequest: vi.fn(),
  updateSalesReport: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
}))

vi.mock('@/lib/sales-report-server', () => ({
  deleteSalesReport: mocks.deleteSalesReport,
  getSalesReportDetail: mocks.getSalesReportDetail,
  getSalesReportOriginalObject: mocks.getSalesReportOriginalObject,
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
const salesReportDetailGetHandler =
  SalesReportDetailRoute.options.server.handlers.GET

describe('/api/sales-reports/$reportId GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
    })
    mocks.canAccessRoute.mockReturnValue(true)
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
})
