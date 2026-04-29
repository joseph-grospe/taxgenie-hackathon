import { describe, expect, it } from 'vitest'

import {
  buildReconciliationTrailStep,
  buildSigningTrailStep,
} from '@/lib/documents-server'

describe('document lifecycle trail helpers', () => {
  it('derives reconciliation status from reconciliation records', () => {
    expect(buildReconciliationTrailStep('Processing')).toEqual({
      label: 'Reconciliation',
      status: 'pending',
    })

    expect(buildReconciliationTrailStep('Ready')).toEqual({
      label: 'Reconciliation',
      status: 'active',
      detail: 'Ready for reconciliation.',
    })

    expect(
      buildReconciliationTrailStep('Ready', {
        matchStatus: 'matched',
        hasDifference: false,
        createdAt: new Date('2026-04-28T10:00:00.000Z'),
      }),
    ).toEqual({
      label: 'Reconciliation',
      status: 'complete',
      detail: 'Reconciliation matched.',
    })

    expect(
      buildReconciliationTrailStep('Ready', {
        matchStatus: 'matched',
        hasDifference: true,
        createdAt: new Date('2026-04-28T10:00:00.000Z'),
      }),
    ).toEqual({
      label: 'Reconciliation',
      status: 'complete',
      detail: 'Reconciliation completed with variance.',
    })

    expect(
      buildReconciliationTrailStep('Ready', {
        matchStatus: 'unmatched',
        hasDifference: true,
        createdAt: new Date('2026-04-28T10:00:00.000Z'),
      }),
    ).toEqual({
      label: 'Reconciliation',
      status: 'error',
      detail: 'Reconciliation did not match this certificate.',
    })
  })

  it('derives signing status from batch signing state', () => {
    expect(buildSigningTrailStep('Ready', { canSign: true })).toEqual({
      label: 'Signing',
      status: 'active',
      detail: 'Ready for batch signing.',
    })

    expect(
      buildSigningTrailStep('Ready', {
        signingSummary: {
          signingStatus: 'signed',
          signedAt: 'Apr 28, 2026, 10:00 AM',
          signedByName: 'Jane Doe',
        },
      }),
    ).toEqual({
      label: 'Signing',
      status: 'complete',
      detail: 'Signed by Jane Doe.',
    })

    expect(
      buildSigningTrailStep('Ready', {
        signingSummary: {
          signingStatus: 'failed',
        },
      }),
    ).toEqual({
      label: 'Signing',
      status: 'error',
      detail: 'Signing failed.',
    })
  })
})
