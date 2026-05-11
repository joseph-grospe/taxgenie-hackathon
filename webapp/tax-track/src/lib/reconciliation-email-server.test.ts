import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildReconciliationWorkbook: vi.fn(),
  createSesServerClient: vi.fn(),
  getDb: vi.fn(),
  getPendingReconciliationCustomerEmailRows: vi.fn(),
  getReconciliationRow: vi.fn(),
  getSesFromEmail: vi.fn(),
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
}))

vi.mock('@/lib/reconciliation-server', () => ({
  getPendingReconciliationCustomerEmailRows:
    mocks.getPendingReconciliationCustomerEmailRows,
  getReconciliationRow: mocks.getReconciliationRow,
}))

import { sendReconciliationEmail } from '@/lib/reconciliation-email-server'

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
    .mockReturnValueOnce(buildSelectChain(input.entityRows))

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
    | { input?: { Destinations?: Array<string> } }
    | undefined

  return command?.input
}

describe('reconciliation-email-server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.buildReconciliationWorkbook.mockResolvedValue(Buffer.from('xlsx'))
    mocks.createSesServerClient.mockReturnValue({ send: mocks.send })
    mocks.getPendingReconciliationCustomerEmailRows.mockResolvedValue([row])
    mocks.getSesFromEmail.mockReturnValue('ar@example.com')
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
      'No pending reconciliation rows found for this customer.',
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
