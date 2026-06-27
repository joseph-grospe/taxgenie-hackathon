import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getReconciliationEmailPreview,
  sendReconciliationEmail,
} from '@/lib/reconciliation-email-server'

const mocks = vi.hoisted(() => ({
  buildReconciliationWorkbook: vi.fn(),
  createSesServerClient: vi.fn(),
  getDb: vi.fn(),
  getPendingReconciliationCustomerEmailRows: vi.fn(),
  getReconciliationRow: vi.fn(),
  getSesFromEmail: vi.fn(),
  mapViewToWorkbookRow: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@aws-sdk/client-ses', () => ({
  SendRawEmailCommand: class SendRawEmailCommand {
    input: unknown

    constructor(input: unknown) {
      this.input = input
    }
  },
}))

vi.mock('@/lib/aws-server', () => ({
  createSesServerClient: mocks.createSesServerClient,
  getSesFromEmail: mocks.getSesFromEmail,
}))

vi.mock('@/lib/db', () => ({
  getDb: mocks.getDb,
}))

vi.mock('@/lib/reconciliation-report-server', () => ({
  buildReconciliationWorkbook: mocks.buildReconciliationWorkbook,
  mapViewToWorkbookRow: mocks.mapViewToWorkbookRow,
}))

vi.mock('@/lib/reconciliation-server', () => ({
  getPendingReconciliationCustomerEmailRows:
    mocks.getPendingReconciliationCustomerEmailRows,
  getReconciliationRow: mocks.getReconciliationRow,
}))

const row = {
  id: 1,
  uploadBatchId: 'batch-1',
  requestingEntityShortName: 'TMO',
  customerName: 'Customer A',
  tin: '123',
  invoiceNumber: 'INV-1',
  accountingDate: '2025-09-30',
  transactionLineDescription: '2025.07.26-2025.08.25 billing date',
  taxableSales: 100,
  outputVAT: 12,
  prepaidCWT: 2,
  issuerShortnameUsedForMatch: 'ACME',
  derivedBillingMonthMMYY: '0825',
  matchedTaxRecordId: null,
  taxBase: null,
  taxWithheld: null,
  taxBaseDifference: -100,
  taxWithheldDifference: -2,
  hasDifference: true,
  matchStatus: 'unmatched',
  emailSentAt: null,
  createdAt: '2026-04-21T00:00:00.000Z',
  updatedAt: '2026-04-21T00:00:00.000Z',
} as const

const buildSelectChain = (rows: Array<Record<string, unknown>>) => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      limit: vi.fn().mockResolvedValue(rows),
    })),
  })),
})

const buildDbMock = (input: {
  customerRows: Array<Record<string, unknown>>
  tinRows?: Array<Record<string, unknown>>
  entityRows: Array<Record<string, unknown>>
}) => {
  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const updateSet = vi.fn(() => ({
    where: updateWhere,
  }))
  const update = vi.fn(() => ({
    set: updateSet,
  }))
  const select = vi
    .fn()
    .mockReturnValueOnce(buildSelectChain(input.customerRows))

  if (input.tinRows) {
    select.mockReturnValueOnce(buildSelectChain(input.tinRows))
  }

  select.mockReturnValueOnce(buildSelectChain(input.entityRows))

  return {
    select,
    update,
    updateSet,
    updateWhere,
  }
}

const getRawEmail = () => {
  const command = mocks.send.mock.calls[0]?.[0] as
    | { input?: { RawMessage?: { Data?: Buffer } } }
    | undefined

  return command?.input?.RawMessage?.Data?.toString('utf8') ?? ''
}

const getSendCommandInput = () => {
  const command = mocks.send.mock.calls[0]?.[0] as
    | { input?: { Destinations?: Array<string>; Source?: string } }
    | undefined

  return command?.input
}

type MockWorkbookRowInput = Omit<typeof row, 'taxBase' | 'taxWithheld'> & {
  taxBase: number | null
  taxWithheld: number | null
}

describe('reconciliation-email-server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.buildReconciliationWorkbook.mockResolvedValue(Buffer.from('xlsx'))
    mocks.createSesServerClient.mockReturnValue({ send: mocks.send })
    mocks.getPendingReconciliationCustomerEmailRows.mockResolvedValue([row])
    mocks.getSesFromEmail.mockReturnValue('ar@example.com')
    mocks.mapViewToWorkbookRow.mockImplementation(
      (input: MockWorkbookRowInput) => ({
        shortName: input.issuerShortnameUsedForMatch,
        tin: input.tin,
        customerName: input.customerName,
        invoiceNumber: input.invoiceNumber,
        billingMonthMMYY: input.derivedBillingMonthMMYY,
        accountingDate: input.accountingDate,
        taxableSales: input.taxableSales,
        prepaidCWT: input.prepaidCWT,
        collectedTaxBase: input.taxBase ?? 0,
        collectedPrepaidCWT: input.taxWithheld ?? 0,
        taxBaseDifference: input.taxBaseDifference,
        prepaidCWTDifference: input.taxWithheldDifference,
      }),
    )
    mocks.send.mockResolvedValue({})
  })

  it('sends one customer email for all pending rows in the customer group', async () => {
    const secondRow = {
      ...row,
      id: 2,
      invoiceNumber: 'INV-2',
      derivedBillingMonthMMYY: '0925',
    }
    mocks.getReconciliationRow.mockResolvedValue(row)
    mocks.getPendingReconciliationCustomerEmailRows.mockResolvedValue([
      row,
      secondRow,
    ])
    const db = buildDbMock({
      customerRows: [
        {
          customerName: 'Customer A',
          emailAddress: 'customer@example.com',
        },
      ],
      entityRows: [
        {
          companyName: 'THERMA MOBILE, INC.',
          birRegisteredAddress: 'Old Veco Compound Cebu',
          zipCode: '6000',
          tin: '26656611600000',
          emailAddress: 'entity@example.com, customer@example.com',
          regionEmailAddress: 'region@example.com',
        },
      ],
    })
    mocks.getDb.mockReturnValue(db)

    const result = await sendReconciliationEmail(1)

    expect(result).toEqual({
      message: 'Email sent to customer@example.com for 2 reconciliation rows.',
      to: ['customer@example.com'],
      cc: ['entity@example.com', 'region@example.com'],
      subject: 'Urgent Request for BIR Form 2307 | THERMA MOBILE, INC.',
      customerName: 'Customer A',
      sentRowCount: 2,
      sentRowIds: [1, 2],
    })

    expect(
      mocks.getPendingReconciliationCustomerEmailRows,
    ).toHaveBeenCalledWith(row)
    expect(mocks.buildReconciliationWorkbook).toHaveBeenCalledWith([
      row,
      secondRow,
    ])
    const rawEmail = getRawEmail()
    expect(rawEmail).toContain('From: "TBG CWT" <ar@example.com>')
    expect(rawEmail).toContain('Cc: entity@example.com, region@example.com')
    expect(rawEmail).toContain('Company Name: THERMA MOBILE, INC.')
    expect(rawEmail).toContain('BIR Registered Address: Old Veco Compound Cebu')
    expect(rawEmail).toContain('Zip Code: 6000')
    expect(rawEmail).toContain('TIN: 266-566-116-00000')
    expect(rawEmail).toContain('Period: See attached reconciliation breakdown')
    expect(db.update).toHaveBeenCalled()
    expect(db.updateSet).toHaveBeenCalledWith({
      emailSentAt: expect.any(Date),
    })
    expect(getSendCommandInput()?.Source).toBe('ar@example.com')
  })

  it('allows a partial row with unresolved variance to send customer email', async () => {
    const partialVarianceRow = {
      ...row,
      matchedTaxRecordId: 10,
      taxBase: 90,
      taxWithheld: 1,
      taxBaseDifference: -10,
      taxWithheldDifference: -1,
      hasDifference: true,
      matchStatus: 'unmatched',
      matchedAt: null,
    }
    mocks.getReconciliationRow.mockResolvedValue(partialVarianceRow)
    mocks.getPendingReconciliationCustomerEmailRows.mockResolvedValue([
      partialVarianceRow,
    ])
    const db = buildDbMock({
      customerRows: [
        {
          customerName: 'Customer A',
          emailAddress: 'customer@example.com',
        },
      ],
      entityRows: [
        {
          companyName: 'THERMA MOBILE, INC.',
          birRegisteredAddress: 'Old Veco Compound Cebu',
          zipCode: '6000',
          tin: '26656611600000',
          emailAddress: null,
          regionEmailAddress: null,
        },
      ],
    })
    mocks.getDb.mockReturnValue(db)

    const result = await sendReconciliationEmail(1)

    expect(result.sentRowIds).toEqual([1])
    expect(mocks.buildReconciliationWorkbook).toHaveBeenCalledWith([
      partialVarianceRow,
    ])
    expect(mocks.send).toHaveBeenCalled()
  })

  it('sends to every semicolon-separated masterlist recipient', async () => {
    mocks.getReconciliationRow.mockResolvedValue(row)
    const db = buildDbMock({
      customerRows: [
        {
          customerName: 'Customer A',
          emailAddress:
            'padolina.sn@acenergy.com.ph; girlie.caldit@acenrenewables.com; rovimae.buhle@acenrenewables.com',
        },
      ],
      entityRows: [
        {
          companyName: 'THERMA MOBILE, INC.',
          birRegisteredAddress: 'Old Veco Compound Cebu',
          zipCode: '6000',
          tin: '26656611600000',
          emailAddress: 'entity@example.com; girlie.caldit@acenrenewables.com',
          regionEmailAddress: 'region@example.com',
        },
      ],
    })
    mocks.getDb.mockReturnValue(db)

    const result = await sendReconciliationEmail(1)

    expect(result.to).toEqual([
      'padolina.sn@acenergy.com.ph',
      'girlie.caldit@acenrenewables.com',
      'rovimae.buhle@acenrenewables.com',
    ])
    expect(result.cc).toEqual(['entity@example.com', 'region@example.com'])
    expect(getRawEmail()).toContain(
      'To: padolina.sn@acenergy.com.ph, girlie.caldit@acenrenewables.com, rovimae.buhle@acenrenewables.com',
    )
    expect(getSendCommandInput()?.Destinations).toEqual([
      'padolina.sn@acenergy.com.ph',
      'girlie.caldit@acenrenewables.com',
      'rovimae.buhle@acenrenewables.com',
      'entity@example.com',
      'region@example.com',
    ])
  })

  it('falls back to the customer TIN when the masterlist name lookup misses', async () => {
    mocks.getReconciliationRow.mockResolvedValue({
      ...row,
      customerName: 'Customer A Trading Corp.',
      tin: '123-456-789-000',
    })
    const db = buildDbMock({
      customerRows: [],
      tinRows: [
        {
          customerName: 'Customer A',
          emailAddress: 'tin-contact@example.com',
        },
      ],
      entityRows: [
        {
          companyName: 'THERMA MOBILE, INC.',
          birRegisteredAddress: 'Old Veco Compound Cebu',
          zipCode: '6000',
          tin: '26656611600000',
          emailAddress: 'entity@example.com',
          regionEmailAddress: null,
        },
      ],
    })
    mocks.getDb.mockReturnValue(db)

    const result = await sendReconciliationEmail(1)

    expect(result.to).toEqual(['tin-contact@example.com'])
    expect(result.message).toBe(
      'Email sent to tin-contact@example.com for 1 reconciliation row.',
    )
    expect(getSendCommandInput()?.Destinations).toEqual([
      'tin-contact@example.com',
      'entity@example.com',
    ])
  })

  it('uses the formatted billing period when one billing month is included', async () => {
    mocks.getReconciliationRow.mockResolvedValue(row)
    const db = buildDbMock({
      customerRows: [
        {
          customerName: 'Customer A',
          emailAddress: 'customer@example.com',
        },
      ],
      entityRows: [
        {
          companyName: 'THERMA MOBILE, INC.',
          birRegisteredAddress: 'Old Veco Compound Cebu',
          zipCode: '6000',
          tin: '26656611600000',
          emailAddress: null,
          regionEmailAddress: null,
        },
      ],
    })
    mocks.getDb.mockReturnValue(db)

    await sendReconciliationEmail(1)

    expect(getRawEmail()).toContain('Period: August 2025')
  })

  it('builds a preview without generating the workbook, sending SES, or updating rows', async () => {
    mocks.getReconciliationRow.mockResolvedValue(row)
    const db = buildDbMock({
      customerRows: [
        {
          customerName: 'Customer A',
          emailAddress: 'customer@example.com',
        },
      ],
      entityRows: [
        {
          companyName: 'THERMA MOBILE, INC.',
          birRegisteredAddress: 'Old Veco Compound Cebu',
          zipCode: '6000',
          tin: '26656611600000',
          emailAddress: 'entity@example.com',
          regionEmailAddress: 'region@example.com',
        },
      ],
    })
    mocks.getDb.mockReturnValue(db)

    const preview = await getReconciliationEmailPreview(1)

    expect(preview).toEqual({
      to: ['customer@example.com'],
      cc: ['entity@example.com', 'region@example.com'],
      subject: 'Urgent Request for BIR Form 2307 | THERMA MOBILE, INC.',
      body: expect.stringContaining('Dear Valued Customers'),
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
    expect(mocks.buildReconciliationWorkbook).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(db.update).not.toHaveBeenCalled()
  })

  it('fails when no pending reconciliation rows remain for the customer', async () => {
    mocks.getReconciliationRow.mockResolvedValue(row)
    mocks.getPendingReconciliationCustomerEmailRows.mockResolvedValue([])
    mocks.getDb.mockReturnValue(
      buildDbMock({
        customerRows: [],
        entityRows: [],
      }),
    )

    await expect(sendReconciliationEmail(1)).rejects.toThrow(
      'No open-variance reconciliation rows found for this customer.',
    )
    expect(mocks.buildReconciliationWorkbook).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('fails when the reconciliation row has no requesting entity short name', async () => {
    mocks.getReconciliationRow.mockResolvedValue({
      ...row,
      requestingEntityShortName: null,
    })
    const db = buildDbMock({
      customerRows: [
        {
          customerName: 'Customer A',
          emailAddress: 'customer@example.com',
        },
      ],
      entityRows: [],
    })
    mocks.getDb.mockReturnValue(db)

    await expect(sendReconciliationEmail(1)).rejects.toThrow(
      'Requesting entity short name is missing from the reconciliation row.',
    )
    expect(
      mocks.getPendingReconciliationCustomerEmailRows,
    ).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('fails when the customer masterlist email is missing', async () => {
    mocks.getReconciliationRow.mockResolvedValue(row)
    mocks.getDb.mockReturnValue(
      buildDbMock({
        customerRows: [],
        entityRows: [],
      }),
    )

    await expect(sendReconciliationEmail(1)).rejects.toThrow(
      'Customer masterlist entry with email address was not found.',
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('fails when the requesting entity short name is not found', async () => {
    mocks.getReconciliationRow.mockResolvedValue(row)
    mocks.getDb.mockReturnValue(
      buildDbMock({
        customerRows: [
          {
            customerName: 'Customer A',
            emailAddress: 'customer@example.com',
          },
        ],
        entityRows: [],
      }),
    )

    await expect(sendReconciliationEmail(1)).rejects.toThrow(
      'Requesting entity "TMO" was not found in the entities table.',
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
