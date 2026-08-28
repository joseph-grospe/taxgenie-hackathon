import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  atcCodes,
  certificateOverrideChanges,
  certificateOverrideRequests,
  certificateTaxRows,
  documentResults,
  extractedCertificates,
} from '@/lib/schema'

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  getDb: mocks.getDb,
}))

const { approveCertificateOverrideRequest, deriveTaxRowProjection } =
  await import('@/lib/certificate-override-server')

const request = {
  id: 'override-1',
  certificateId: 42,
  status: 'pending',
  requestedByUserId: 'editor-1',
  requestNote: 'Correct the extracted totals.',
  decisionNote: null,
  decidedByUserId: null,
  decidedAt: null,
  createdAt: new Date('2026-07-27T00:00:00.000Z'),
  updatedAt: new Date('2026-07-27T00:00:00.000Z'),
}

const result = {
  id: 42,
  uploadId: '22222222-2222-4222-8222-222222222222',
  batchId: '11111111-1111-4111-8111-111111111111',
  status: 'error',
  certificateKey: 'certificate-1',
  pageNumbers: [1],
  periodStart: '2026-04-01',
  periodEnd: '2026-06-30',
  monthOfQuarter: 'first',
  payeeName: 'PAYEE',
  payeeTin: '00503166300000',
  payeeAddress: null,
  payeeZip: null,
  payeeShortName: 'PAYEE',
  payorName: 'PAYOR',
  payorTin: '0002025240000',
  payorAddress: null,
  payorZip: null,
  payorShortName: 'PAYOR',
  primaryAtcCode: 'WC160',
  totalTaxBase: '1000.00',
  totalTaxWithheld: '20.00',
  signerPrintedName: 'SIGNER',
  signerTitle: null,
  signerTin: null,
  signerCompanyName: null,
  signaturePresent: true,
  signatureConfidence: '0.9300',
  signaturePageNumber: 1,
  signatureSource: 'gemini',
  reasonCodes: ['variance_exceeded'],
  immutableExtraction: {
    totals: { taxBase: '1000.00', taxWithheld: '20.00' },
  },
}

const changes = [
  {
    id: 'change-1',
    requestId: 'override-1',
    fieldPath: 'totals.taxWithheld',
    originalValue: '20.00',
    proposedValue: '24.01',
    status: 'pending',
  },
]

const taxRows = [
  {
    id: 1,
    certificateId: 42,
    lineNumber: 1,
    pageNumber: 1,
    atcCode: 'WC160',
    description: null,
    firstMonthAmount: '1000.00',
    secondMonthAmount: null,
    thirdMonthAmount: null,
    taxBase: '1000.00',
    taxRate: '0.020000',
    taxWithheld: '20.00',
  },
]

function createDb(
  options: {
    changeRows?: typeof changes
    taxRowRows?: typeof taxRows
    atcRuleRows?: Array<{ code: string; taxType: string }>
  } = {},
) {
  let selectCount = 0
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = []
  const db = {
    select: () => {
      selectCount += 1
      const rows =
        selectCount === 1
          ? [request]
          : selectCount === 2
            ? [result]
            : selectCount === 3
              ? (options.changeRows ?? changes)
              : selectCount === 4
                ? (options.taxRowRows ?? taxRows)
                : (options.atcRuleRows ?? [])
      return {
        from: () => ({
          where: () => {
            const promise = Promise.resolve(rows)
            return Object.assign(promise, {
              limit: () => Promise.resolve(rows),
            })
          },
        }),
      }
    },
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: (table: unknown) => ({
          set: (values: Record<string, unknown>) => ({
            where: async () => {
              updates.push({ table, values })
              return []
            },
          }),
        }),
      }
      return callback(tx)
    },
  }
  return { db, updates }
}

describe('certificate override approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves immutable extraction and updates only effective projections plus audit rows', async () => {
    const harness = createDb()
    mocks.getDb.mockReturnValue(harness.db)

    const approved = await approveCertificateOverrideRequest({
      requestId: 'override-1',
      userId: 'admin-1',
      decisionNote: 'Reviewed against the source certificate.',
    })

    expect(approved).toMatchObject({
      requestId: 'override-1',
      certificateId: 42,
      immutableExtractedValues: result.immutableExtraction,
      effectiveValues: {
        totals: { taxBase: '1000.00', taxWithheld: '24.01' },
      },
    })
    expect(
      harness.updates.some((update) => update.table === documentResults),
    ).toBe(false)
    expect(
      harness.updates.find((update) => update.table === extractedCertificates)
        ?.values,
    ).toMatchObject({
      totalTaxWithheld: '24.01',
    })
    expect(
      harness.updates.some(
        (update) => update.table === certificateOverrideRequests,
      ),
    ).toBe(true)
    expect(
      harness.updates.some(
        (update) => update.table === certificateOverrideChanges,
      ),
    ).toBe(true)
    expect(
      harness.updates.some((update) => update.table === certificateTaxRows),
    ).toBe(false)
  })

  it('prevents requesters from approving their own changes', async () => {
    const harness = createDb()
    mocks.getDb.mockReturnValue(harness.db)

    await expect(
      approveCertificateOverrideRequest({
        requestId: 'override-1',
        userId: 'editor-1',
        decisionNote: 'Self approved.',
      }),
    ).rejects.toThrow('cannot approve your own')
    expect(harness.updates).toEqual([])
  })

  it('derives totals from every complete row matching the primary ATC', () => {
    const multiAtcRows = [
      {
        ...taxRows[0],
        atcCode: 'WC157',
        taxBase: '28030.86',
        taxWithheld: '560.62',
      },
      {
        ...taxRows[0],
        id: 2,
        lineNumber: 2,
        atcCode: 'WV020',
        taxBase: '28030.86',
        taxRate: '0.050000',
        taxWithheld: '1401.54',
      },
    ] as Array<typeof certificateTaxRows.$inferSelect>

    expect(
      deriveTaxRowProjection(multiAtcRows, new Map(), [
        { code: 'WC157', taxType: 'WE' },
        { code: 'WV020', taxType: 'WV' },
      ]),
    ).toEqual({
      primaryAtcCode: 'WC157',
      totalTaxBase: '28030.86',
      totalTaxWithheld: '560.62',
    })

    expect(
      deriveTaxRowProjection([multiAtcRows[1]], new Map(), [
        { code: 'WV020', taxType: 'WV' },
      ]),
    ).toEqual({
      primaryAtcCode: 'WV020',
      totalTaxBase: '28030.86',
      totalTaxWithheld: '1401.54',
    })

    expect(
      deriveTaxRowProjection(
        [
          multiAtcRows[0],
          {
            ...multiAtcRows[0],
            id: 3,
            lineNumber: 3,
            atcCode: 'wc-157',
            taxBase: '100.00',
            taxWithheld: '2.00',
          },
        ],
        new Map(),
        [{ code: 'WC157', taxType: 'WE' }],
      ),
    ).toEqual({
      primaryAtcCode: 'WC157',
      totalTaxBase: '28130.86',
      totalTaxWithheld: '562.62',
    })
  })

  it('recomputes summaries and fingerprint after an approved row correction', async () => {
    const rowCorrection = [
      {
        ...changes[0],
        fieldPath: 'taxRows.1.taxWithheld',
        proposedValue: '25.00',
      },
    ]
    const harness = createDb({
      changeRows: rowCorrection,
      atcRuleRows: [{ code: 'WC160', taxType: 'WE' }],
    })
    mocks.getDb.mockReturnValue(harness.db)

    const approved = await approveCertificateOverrideRequest({
      requestId: 'override-1',
      userId: 'admin-1',
      decisionNote: 'Matched the corrected certificate row.',
    })

    const certificateUpdate = harness.updates.find(
      (update) => update.table === extractedCertificates,
    )?.values
    expect(certificateUpdate).toMatchObject({
      primaryAtcCode: 'WC160',
      totalTaxBase: '1000.00',
      totalTaxWithheld: '25.00',
    })
    expect(certificateUpdate?.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(
      harness.updates.filter((update) => update.table === certificateTaxRows),
    ).toHaveLength(1)
    expect(approved.effectiveValues).toMatchObject({
      primaryAtcCode: 'WC160',
      totals: { taxBase: '1000.00', taxWithheld: '25.00' },
    })
    expect(harness.updates.some((update) => update.table === atcCodes)).toBe(
      false,
    )
  })

  it('keeps explicit legacy primary ATC and total overrides authoritative', async () => {
    const rowAndLegacyCorrections = [
      {
        ...changes[0],
        id: 'change-row',
        fieldPath: 'taxRows.1.taxWithheld',
        proposedValue: '25.00',
      },
      {
        ...changes[0],
        id: 'change-atc',
        fieldPath: 'primaryAtcCode',
        proposedValue: 'wc-999',
      },
      {
        ...changes[0],
        id: 'change-base',
        fieldPath: 'totals.taxBase',
        proposedValue: '777.00',
      },
      {
        ...changes[0],
        id: 'change-withheld',
        fieldPath: 'totals.taxWithheld',
        proposedValue: '88.00',
      },
    ]
    const harness = createDb({
      changeRows: rowAndLegacyCorrections,
      atcRuleRows: [{ code: 'WC160', taxType: 'WE' }],
    })
    mocks.getDb.mockReturnValue(harness.db)

    await approveCertificateOverrideRequest({
      requestId: 'override-1',
      userId: 'admin-1',
      decisionNote: 'Approved explicit legacy values.',
    })

    expect(
      harness.updates.find((update) => update.table === extractedCertificates)
        ?.values,
    ).toMatchObject({
      primaryAtcCode: 'WC999',
      totalTaxBase: '777.00',
      totalTaxWithheld: '88.00',
    })
  })

  it('recomputes totals when the explicit primary ATC changes', async () => {
    const primaryAtcCorrection = [
      {
        ...changes[0],
        fieldPath: 'primaryAtcCode',
        proposedValue: 'wv-020',
      },
    ]
    const alternateRows = [
      taxRows[0],
      {
        ...taxRows[0],
        id: 2,
        lineNumber: 2,
        atcCode: 'WV020',
        taxBase: '28030.86',
        taxRate: '0.050000',
        taxWithheld: '1401.54',
      },
    ]
    const harness = createDb({
      changeRows: primaryAtcCorrection,
      taxRowRows: alternateRows,
      atcRuleRows: [
        { code: 'WC160', taxType: 'WE' },
        { code: 'WV020', taxType: 'WV' },
      ],
    })
    mocks.getDb.mockReturnValue(harness.db)

    await approveCertificateOverrideRequest({
      requestId: 'override-1',
      userId: 'admin-1',
      decisionNote: 'Use the corrected primary ATC.',
    })

    expect(
      harness.updates.find((update) => update.table === extractedCertificates)
        ?.values,
    ).toMatchObject({
      primaryAtcCode: 'WV020',
      totalTaxBase: '28030.86',
      totalTaxWithheld: '1401.54',
    })
  })
})
