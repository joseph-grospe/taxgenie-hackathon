import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route as ReconciliationDetailRoute } from '@/routes/api/reconciliation.$rowId'
import { Route as ReconciliationExportRoute } from '@/routes/api/reconciliation/export'
import { reconciliationImportHandler } from '@/routes/api/reconciliation/import'
import { batchReconciliationImportHandler } from '@/routes/api/uploads/batches.$batchId.reconciliation.import'

const mocks = vi.hoisted(() => ({
  importReconciliationWorkbook: vi.fn(),
  listReconciliationResults: vi.fn(),
  sendReconciliationEmail: vi.fn(),
  exportReconciliationReport: vi.fn(),
  exportBatchReconciliationReport: vi.fn(),
  isValidReconciliationExportPeriod: vi.fn(),
  getReconciliationRow: vi.fn(),
  resolveContextFromRequest: vi.fn(),
  canAccessRoute: vi.fn(),
  canExportExcel: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
  canExport: {
    excel: mocks.canExportExcel,
  },
}))

vi.mock('@/lib/reconciliation-server', () => ({
  importReconciliationWorkbook: mocks.importReconciliationWorkbook,
  listReconciliationResults: mocks.listReconciliationResults,
  getReconciliationRow: mocks.getReconciliationRow,
}))

vi.mock('@/lib/reconciliation-email-server', () => ({
  sendReconciliationEmail: mocks.sendReconciliationEmail,
}))

vi.mock('@/lib/reconciliation-report-server', () => ({
  exportReconciliationReport: mocks.exportReconciliationReport,
  exportBatchReconciliationReport: mocks.exportBatchReconciliationReport,
  isValidReconciliationExportPeriod: mocks.isValidReconciliationExportPeriod,
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

const buildRequest = (file?: File) => {
  const formData = new FormData()
  if (file) {
    formData.set('file', file)
  }

  return new Request('http://localhost/api/reconciliation', {
    method: 'POST',
    body: formData,
  })
}

const readJson = async (response: Response) => response.json()
const reconciliationDetailPostHandler =
  ReconciliationDetailRoute.options.server.handlers.POST
const reconciliationExportGetHandler =
  ReconciliationExportRoute.options.server.handlers.GET

describe('/api/reconciliation/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
      canExportExcel: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canExportExcel.mockReturnValue(true)
    mocks.isValidReconciliationExportPeriod.mockReturnValue(true)
  })

  it('directs users to the batch import flow', async () => {
    const response = await reconciliationImportHandler({
      request: buildRequest(),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Revenue data import is now handled inside a closed upload batch.',
    })
  })
})

describe('/api/uploads/batches/$batchId/reconciliation/import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
      canExportExcel: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canExportExcel.mockReturnValue(true)
    mocks.isValidReconciliationExportPeriod.mockReturnValue(true)
  })

  it('returns 401 when unauthenticated', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue(null)

    const response = await batchReconciliationImportHandler({
      request: buildRequest(
        new File(['content'], 'TMO_SALES_REPORT.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Authentication is required to import revenue data.',
    })
  })

  it('returns 403 when the role cannot upload', async () => {
    mocks.canAccessRoute.mockReturnValue(false)

    const response = await batchReconciliationImportHandler({
      request: buildRequest(
        new File(['content'], 'sheet.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to import revenue data.',
    })
  })

  it('returns 400 when the file is missing', async () => {
    const response = await batchReconciliationImportHandler({
      request: buildRequest(),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'An Excel file is required.',
    })
  })

  it('returns 400 for invalid file type errors', async () => {
    mocks.importReconciliationWorkbook.mockRejectedValue(
      new Error(
        'Invalid file type. Only Excel files (.xlsx, .xls) are supported.',
      ),
    )

    const response = await batchReconciliationImportHandler({
      request: buildRequest(new File(['a'], 'sheet.csv', { type: 'text/csv' })),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Invalid file type. Only Excel files (.xlsx, .xls) are supported.',
    })
  })

  it('returns 400 for missing required header errors', async () => {
    mocks.importReconciliationWorkbook.mockRejectedValue(
      new Error('Missing required headers: TIN.'),
    )

    const response = await batchReconciliationImportHandler({
      request: buildRequest(
        new File(['content'], 'sheet.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Missing required headers: TIN.',
    })
  })

  it('returns 400 for malformed billing date ranges', async () => {
    mocks.importReconciliationWorkbook.mockRejectedValue(
      new Error(
        'Row 2: malformed billing date range in Transaction Line Description.',
      ),
    )

    const response = await batchReconciliationImportHandler({
      request: buildRequest(
        new File(['content'], 'sheet.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error:
        'Row 2: malformed billing date range in Transaction Line Description.',
    })
  })

  it('returns 201 after a successful import', async () => {
    mocks.importReconciliationWorkbook.mockResolvedValue({
      rows: [
        {
          id: 1,
          uploadBatchId: 'batch-1',
          requestingEntityShortName: 'TMO',
          customerName: 'ACME',
          tin: '123',
          invoiceNumber: 'INV-1',
          accountingDate: '2025-09-30',
          transactionLineDescription: '2025.07.26-2025.08.25 billing date',
          taxableSales: 100,
          outputVAT: 12,
          prepaidCWT: 2,
          issuerShortnameUsedForMatch: 'ACME',
          derivedBillingMonthMMYY: '0825',
          matchedTaxRecordId: 9,
          taxBase: 100,
          taxWithheld: 2,
          taxBaseDifference: 0,
          taxWithheldDifference: 0,
          hasDifference: false,
          matchStatus: 'matched',
          matchedAt: '2026-04-21T00:30:00.000Z',
          emailSentAt: null,
          daysUncollected: null,
          createdAt: '2026-04-21T00:00:00.000Z',
          updatedAt: '2026-04-21T00:00:00.000Z',
        },
      ],
      summary: {
        totalRecords: 1,
        matched: 1,
        unmatched: 0,
        varianceTotal: 0,
      },
    })

    const response = await batchReconciliationImportHandler({
      request: buildRequest(
        new File(['content'], 'sheet.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ),
      params: { batchId: 'batch-1' },
    })

    expect(response.status).toBe(201)
    expect(mocks.importReconciliationWorkbook).toHaveBeenCalledWith(
      expect.any(File),
      {
        uploadBatchId: 'batch-1',
        userId: 'user-1',
        replaceExisting: true,
      },
    )
    await expect(readJson(response)).resolves.toEqual({
      rows: expect.any(Array),
      summary: {
        totalRecords: 1,
        matched: 1,
        unmatched: 0,
        varianceTotal: 0,
      },
    })
  })
})

describe('/api/reconciliation/$rowId POST', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
      canExportExcel: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canExportExcel.mockReturnValue(true)
    mocks.isValidReconciliationExportPeriod.mockReturnValue(true)
  })

  it('returns 400 when the row id is invalid', async () => {
    const response = await reconciliationDetailPostHandler({
      request: new Request('http://localhost/api/reconciliation/abc', {
        method: 'POST',
      }),
      params: { rowId: 'abc' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Reconciliation row not found.',
    })
  })

  it('returns 400 when email sending fails', async () => {
    mocks.sendReconciliationEmail.mockRejectedValue(
      new Error('Customer email address is missing from the masterlist.'),
    )

    const response = await reconciliationDetailPostHandler({
      request: new Request('http://localhost/api/reconciliation/1', {
        method: 'POST',
      }),
      params: { rowId: '1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Customer email address is missing from the masterlist.',
    })
  })

  it('returns 200 after sending a reconciliation email', async () => {
    mocks.sendReconciliationEmail.mockResolvedValue({
      message: 'Email sent to customer@example.com for 2 reconciliation rows.',
      to: ['customer@example.com'],
      cc: ['region@example.com'],
      subject: 'Urgent Request for BIR Form 2307 | BACon',
      customerName: 'Customer A',
      sentRowCount: 2,
      sentRowIds: [1, 2],
    })

    const response = await reconciliationDetailPostHandler({
      request: new Request('http://localhost/api/reconciliation/1', {
        method: 'POST',
      }),
      params: { rowId: '1' },
    })

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toEqual({
      message: 'Email sent to customer@example.com for 2 reconciliation rows.',
      to: ['customer@example.com'],
      cc: ['region@example.com'],
      subject: 'Urgent Request for BIR Form 2307 | BACon',
      customerName: 'Customer A',
      sentRowCount: 2,
      sentRowIds: [1, 2],
    })
  })
})

describe('/api/reconciliation/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
      canExportExcel: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canExportExcel.mockReturnValue(true)
    mocks.isValidReconciliationExportPeriod.mockReturnValue(true)
  })

  it('returns 400 for invalid export granularity', async () => {
    const response = await reconciliationExportGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/export?granularity=weekly&periodValue=0825',
      ),
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'Export granularity must be either monthly or quarterly.',
    })
  })

  it('returns 403 when excel export is not allowed', async () => {
    mocks.canExportExcel.mockReturnValue(false)

    const response = await reconciliationExportGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/export?granularity=monthly&periodValue=0825',
      ),
    })

    expect(response.status).toBe(403)
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to export reconciliation workbooks.',
    })
  })

  it('returns the workbook attachment when export succeeds', async () => {
    mocks.exportReconciliationReport.mockResolvedValue({
      fileName: 'Reconciliation-Report-Monthly-August-2025.xlsx',
      content: Buffer.from('excel-bytes'),
    })

    const response = await reconciliationExportGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/export?granularity=monthly&periodValue=0825',
      ),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Reconciliation-Report-Monthly-August-2025.xlsx"',
    )
    const content = Buffer.from(await response.arrayBuffer())
    expect(content.equals(Buffer.from('excel-bytes'))).toBe(true)
  })
})
