import { describe, expect, it } from 'vitest'

import type { TaxRecordCandidate } from '@/lib/reconciliation-server'
import type { ProgressiveReconciliationRowInput } from '@/lib/reconciliation-progressive-server'
import {
  buildProgressiveReconciliationAssignments,
  resolveReconciliationMatchState,
} from '@/lib/reconciliation-progressive-server'

const row = (
  input: Partial<ProgressiveReconciliationRowInput> & { key: string },
): ProgressiveReconciliationRowInput => ({
  rowOrder: Number(input.key),
  issuerShortnameUsedForMatch: 'ACME',
  derivedBillingMonthMMYY: '0825',
  invoiceNumber: `INV-${input.key}`,
  taxableSales: 100,
  prepaidCWT: 2,
  ...input,
})

const candidate = (
  input: Partial<TaxRecordCandidate> & { taxRecordId: number },
) => {
  const taxRecordId = input.taxRecordId

  return {
    batchId: 'batch-1',
    uploadId: `upload-${taxRecordId}`,
    sourceFileId: `source-${taxRecordId}`,
    fileName: `BIR2307_ACME_TMO_REF-${taxRecordId}_0825_20250903.pdf`,
    uploadedAt: new Date(`2025-09-0${taxRecordId}T00:00:00.000Z`),
    fileCreatedAt: new Date(`2025-09-0${taxRecordId}T00:00:00.000Z`),
    resultCreatedAt: new Date(`2025-09-0${taxRecordId}T00:00:00.000Z`),
    taxBase: 100,
    taxWithheld: 2,
    metadata: {
      documentType: 'BIR2307',
      issuerShortname: 'ACME',
      normalizedIssuerShortname: 'ACME',
      recipientShortname: 'TMO',
      settlementReferenceNumber: `INV-${taxRecordId}`,
      billingMonthMMYY: '0825',
      dateUploaded: '20250903',
    },
    ...input,
    taxRecordId,
  }
}

describe('buildProgressiveReconciliationAssignments', () => {
  it('links one certificate to only one of multiple matching sales rows', () => {
    const assignments = buildProgressiveReconciliationAssignments(
      [
        row({ key: '1', invoiceNumber: 'INV-1' }),
        row({ key: '2', invoiceNumber: 'INV-2' }),
        row({ key: '3', invoiceNumber: 'INV-3' }),
      ],
      [candidate({ taxRecordId: 2 })],
    )

    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      rowKey: '2',
      candidate: { taxRecordId: 2 },
      difference: {
        taxBaseDifference: 0,
        taxWithheldDifference: 0,
        hasDifference: false,
      },
    })
  })

  it('allows one row to collect multiple certificates until the variance is resolved', () => {
    const assignments = buildProgressiveReconciliationAssignments(
      [
        row({
          key: '1',
          taxableSales: 300,
          prepaidCWT: 6,
        }),
      ],
      [
        candidate({ taxRecordId: 1, taxBase: 100, taxWithheld: 2 }),
        candidate({ taxRecordId: 2, taxBase: 200, taxWithheld: 4 }),
        candidate({ taxRecordId: 3, taxBase: 10, taxWithheld: 1 }),
      ],
    )

    expect(
      assignments.map((assignment) => assignment.candidate.taxRecordId),
    ).toEqual([2, 1])
    expect(assignments.at(-1)).toMatchObject({
      rowKey: '1',
      aggregateTaxBase: 300,
      aggregateTaxWithheld: 6,
      difference: {
        taxBaseDifference: 0,
        taxWithheldDifference: 0,
        hasDifference: false,
      },
    })
  })

  it('excludes certificates that are already linked to another active result', () => {
    const assignments = buildProgressiveReconciliationAssignments(
      [row({ key: '1' })],
      [candidate({ taxRecordId: 1 })],
      new Set([1]),
    )

    expect(assignments).toEqual([])
  })
})

describe('resolveReconciliationMatchState', () => {
  const matchedAt = new Date('2026-04-21T00:30:00.000Z')

  it('keeps partial certificate collections unmatched while variance remains open', () => {
    expect(
      resolveReconciliationMatchState({
        hasCollections: true,
        hasDifference: true,
        matchedAt,
      }),
    ).toEqual({
      matchStatus: 'unmatched',
      matchedAt: null,
    })
  })

  it('matches collected rows only when variance is fully cleared', () => {
    expect(
      resolveReconciliationMatchState({
        hasCollections: true,
        hasDifference: false,
        matchedAt,
      }),
    ).toEqual({
      matchStatus: 'matched',
      matchedAt,
    })
  })

  it('does not mark rows matched without an attached certificate collection', () => {
    expect(
      resolveReconciliationMatchState({
        hasCollections: false,
        hasDifference: false,
        matchedAt,
      }),
    ).toEqual({
      matchStatus: 'unmatched',
      matchedAt: null,
    })
  })
})
