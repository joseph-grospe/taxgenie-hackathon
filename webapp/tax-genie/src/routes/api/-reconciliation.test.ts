import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route as ReconciliationDetailRoute } from '@/routes/api/reconciliation.$rowId'
import { Route as ReconciliationEmailAttachmentRoute } from '@/routes/api/reconciliation.$rowId.email-attachment'
import { Route as ReconciliationEmailPreviewRoute } from '@/routes/api/reconciliation.$rowId.email-preview'
import { Route as ReconciliationExportRoute } from '@/routes/api/reconciliation/export'

const mocks = vi.hoisted(() => ({
  listReconciliationResults: vi.fn(),
  sendReconciliationEmail: vi.fn(),
  getReconciliationEmailPreview: vi.fn(),
  buildReconciliationEmailAttachment: vi.fn(),
  exportReconciliationReport: vi.fn(),
  exportBatchReconciliationReport: vi.fn(),
  isValidReconciliationExportPeriod: vi.fn(),
  getReconciliationRow: vi.fn(),
  resolveContextFromRequest: vi.fn(),
  canAccessRoute: vi.fn(),
  canExportExcel: vi.fn(),
  isAdmin: vi.fn(),
  isEditor: vi.fn(),
}))

vi.mock('@/lib/access-control', () => ({
  canAccessRoute: mocks.canAccessRoute,
  canExport: {
    excel: mocks.canExportExcel,
  },
  isAdmin: mocks.isAdmin,
  isEditor: mocks.isEditor,
}))

vi.mock('@/lib/reconciliation-server', () => ({
  listReconciliationResults: mocks.listReconciliationResults,
  getReconciliationRow: mocks.getReconciliationRow,
}))

vi.mock('@/lib/reconciliation-email-server', () => ({
  buildReconciliationEmailAttachment: mocks.buildReconciliationEmailAttachment,
  getReconciliationEmailPreview: mocks.getReconciliationEmailPreview,
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

const readJson = async (response: Response) => response.json()
const reconciliationDetailPostHandler =
  ReconciliationDetailRoute.options.server.handlers.POST
const reconciliationEmailAttachmentGetHandler =
  ReconciliationEmailAttachmentRoute.options.server.handlers.GET
const reconciliationEmailPreviewGetHandler =
  ReconciliationEmailPreviewRoute.options.server.handlers.GET
const reconciliationExportGetHandler =
  ReconciliationExportRoute.options.server.handlers.GET

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
    mocks.isAdmin.mockImplementation((role: string) =>
      ['super_admin', 'admin'].includes(role),
    )
    mocks.isEditor.mockImplementation((role: string) => role === 'editor')
    mocks.isValidReconciliationExportPeriod.mockReturnValue(true)
  })

  it('returns 403 when a viewer tries to send reconciliation email', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'viewer-1',
      role: 'viewer',
      canExportExcel: true,
    })

    const response = await reconciliationDetailPostHandler({
      request: new Request('http://localhost/api/reconciliation/1', {
        method: 'POST',
      }),
      params: { rowId: '1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.sendReconciliationEmail).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to send reconciliation emails.',
    })
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

describe('/api/reconciliation/$rowId/email-preview GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
      canExportExcel: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.isAdmin.mockImplementation((role: string) =>
      ['super_admin', 'admin'].includes(role),
    )
    mocks.isEditor.mockImplementation((role: string) => role === 'editor')
  })

  it('returns the stable feature-disabled response in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TAXGENIE_ENABLE_OUTBOUND_EMAIL', 'false')

    try {
      const response = await reconciliationEmailPreviewGetHandler({
        request: new Request(
          'http://localhost/api/reconciliation/1/email-preview',
        ),
        params: { rowId: '1' },
      })

      expect(response.status).toBe(503)
      await expect(readJson(response)).resolves.toEqual({
        error: 'feature_disabled',
      })
      expect(mocks.getReconciliationEmailPreview).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('returns 403 when a viewer tries to preview reconciliation email', async () => {
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'viewer-1',
      role: 'viewer',
      canExportExcel: true,
    })

    const response = await reconciliationEmailPreviewGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/1/email-preview',
      ),
      params: { rowId: '1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.getReconciliationEmailPreview).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to preview reconciliation emails.',
    })
  })

  it('returns 400 when the preview row id is invalid', async () => {
    const response = await reconciliationEmailPreviewGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/abc/email-preview',
      ),
      params: { rowId: 'abc' },
    })

    expect(response.status).toBe(400)
    expect(mocks.getReconciliationEmailPreview).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'Reconciliation row not found.',
    })
  })

  it('returns 400 when the preview row is no longer eligible', async () => {
    mocks.getReconciliationEmailPreview.mockRejectedValue(
      new Error(
        'No open-variance reconciliation rows found for this customer.',
      ),
    )

    const response = await reconciliationEmailPreviewGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/1/email-preview',
      ),
      params: { rowId: '1' },
    })

    expect(response.status).toBe(400)
    await expect(readJson(response)).resolves.toEqual({
      error: 'No open-variance reconciliation rows found for this customer.',
    })
  })

  it('returns reconciliation email preview metadata and workbook rows', async () => {
    mocks.getReconciliationEmailPreview.mockResolvedValue({
      to: ['customer@example.com'],
      cc: ['region@example.com'],
      subject: 'Urgent Request for BIR Form 2307 | BACon',
      body: 'Dear Valued Customers',
      customerName: 'Customer A',
      attachmentFileName: 'Outstanding-CWT-Reconciliation-Report.xlsx',
      rowCount: 1,
      rows: [
        {
          shortName: 'ACME',
          tin: '123',
          customerName: 'Customer A',
          invoiceNumber: 'INV-1',
          billingMonthMMYY: '0825',
          accountingDate: '2025-09-30',
          taxableSales: 100,
          prepaidCWT: 2,
          collectedTaxBase: 0,
          collectedPrepaidCWT: 0,
          taxBaseDifference: -100,
          prepaidCWTDifference: -2,
        },
      ],
    })

    const response = await reconciliationEmailPreviewGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/1/email-preview',
      ),
      params: { rowId: '1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.getReconciliationEmailPreview).toHaveBeenCalledWith(1)
    await expect(readJson(response)).resolves.toEqual({
      to: ['customer@example.com'],
      cc: ['region@example.com'],
      subject: 'Urgent Request for BIR Form 2307 | BACon',
      body: 'Dear Valued Customers',
      customerName: 'Customer A',
      attachmentFileName: 'Outstanding-CWT-Reconciliation-Report.xlsx',
      rowCount: 1,
      rows: [
        {
          shortName: 'ACME',
          tin: '123',
          customerName: 'Customer A',
          invoiceNumber: 'INV-1',
          billingMonthMMYY: '0825',
          accountingDate: '2025-09-30',
          taxableSales: 100,
          prepaidCWT: 2,
          collectedTaxBase: 0,
          collectedPrepaidCWT: 0,
          taxBaseDifference: -100,
          prepaidCWTDifference: -2,
        },
      ],
    })
  })
})

describe('/api/reconciliation/$rowId/email-attachment GET', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContextFromRequest.mockResolvedValue({
      userId: 'user-1',
      role: 'editor',
      canExportExcel: true,
    })
    mocks.canAccessRoute.mockReturnValue(true)
    mocks.canExportExcel.mockReturnValue(true)
    mocks.isAdmin.mockImplementation((role: string) =>
      ['super_admin', 'admin'].includes(role),
    )
    mocks.isEditor.mockImplementation((role: string) => role === 'editor')
  })

  it('returns 403 when excel export is not allowed for attachment download', async () => {
    mocks.canExportExcel.mockReturnValue(false)

    const response = await reconciliationEmailAttachmentGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/1/email-attachment',
      ),
      params: { rowId: '1' },
    })

    expect(response.status).toBe(403)
    expect(mocks.buildReconciliationEmailAttachment).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'You do not have permission to export reconciliation workbooks.',
    })
  })

  it('returns the generated reconciliation email attachment', async () => {
    mocks.buildReconciliationEmailAttachment.mockResolvedValue({
      fileName: 'Outstanding-CWT-Reconciliation-Report.xlsx',
      content: Buffer.from('excel-bytes'),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const response = await reconciliationEmailAttachmentGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/1/email-attachment',
      ),
      params: { rowId: '1' },
    })

    expect(response.status).toBe(200)
    expect(mocks.buildReconciliationEmailAttachment).toHaveBeenCalledWith(1)
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Outstanding-CWT-Reconciliation-Report.xlsx"',
    )
    const content = Buffer.from(await response.arrayBuffer())
    expect(content.equals(Buffer.from('excel-bytes'))).toBe(true)
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
      error: 'Export granularity must be monthly, quarterly, or annual.',
    })
  })

  it('returns 400 for an invalid annual export period', async () => {
    mocks.isValidReconciliationExportPeriod.mockReturnValue(false)

    const response = await reconciliationExportGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/export?granularity=annual&periodValue=25',
      ),
    })

    expect(response.status).toBe(400)
    expect(mocks.isValidReconciliationExportPeriod).toHaveBeenCalledWith(
      'annual',
      '25',
    )
    expect(mocks.exportReconciliationReport).not.toHaveBeenCalled()
    await expect(readJson(response)).resolves.toEqual({
      error: 'A valid export period is required.',
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

  it('returns the annual workbook attachment when export succeeds', async () => {
    mocks.exportReconciliationReport.mockResolvedValue({
      fileName: 'Reconciliation-Report-Annual-2025.xlsx',
      content: Buffer.from('annual-excel-bytes'),
    })

    const response = await reconciliationExportGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/export?granularity=annual&periodValue=2025&entityId=7',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.exportReconciliationReport).toHaveBeenCalledWith(
      'annual',
      '2025',
      { entityId: '7' },
    )
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="Reconciliation-Report-Annual-2025.xlsx"',
    )
    const content = Buffer.from(await response.arrayBuffer())
    expect(content.equals(Buffer.from('annual-excel-bytes'))).toBe(true)
  })

  it('passes optional customer name to the export service', async () => {
    mocks.exportReconciliationReport.mockResolvedValue({
      fileName: 'Reconciliation-Report-Monthly-August-2025-Acme-Solar.xlsx',
      content: Buffer.from('customer-excel-bytes'),
    })

    const response = await reconciliationExportGetHandler({
      request: new Request(
        'http://localhost/api/reconciliation/export?granularity=monthly&periodValue=0825&entityId=7&customerName=+Acme+Solar+',
      ),
    })

    expect(response.status).toBe(200)
    expect(mocks.exportReconciliationReport).toHaveBeenCalledWith(
      'monthly',
      '0825',
      { entityId: '7', customerName: 'Acme Solar' },
    )
    const content = Buffer.from(await response.arrayBuffer())
    expect(content.equals(Buffer.from('customer-excel-bytes'))).toBe(true)
  })
})
