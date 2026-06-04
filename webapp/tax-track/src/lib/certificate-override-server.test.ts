import { describe, expect, it } from 'vitest'

import { getCertificateOverrideEligibility } from '@/lib/certificate-override-server'

const createResult = (
  overrides: Record<string, unknown> = {},
): Parameters<typeof getCertificateOverrideEligibility>[0]['result'] =>
  ({
    id: 1,
    status: 'error',
    payload: {
      decision: {
        phase: 'validate',
        reasonCodes: ['masterlist_payor_not_found'],
      },
    },
    validation: {
      status: 'invalid',
      reasons: ['masterlist_payor_not_found'],
      checks: [
        {
          code: 'MASTERLIST',
          passed: false,
          message: 'Payor was not found in masterlist.',
        },
      ],
    },
    reasonCodes: ['masterlist_payor_not_found'],
    ...overrides,
  }) as Parameters<typeof getCertificateOverrideEligibility>[0]['result']

describe('certificate override eligibility', () => {
  it('allows validation-phase error results with validation evidence', () => {
    const result = getCertificateOverrideEligibility({
      result: createResult(),
    })

    expect(result).toEqual({ eligible: true, reason: null })
  })

  it('blocks non-error results including successful and duplicate rows', () => {
    expect(
      getCertificateOverrideEligibility({
        result: createResult({ status: 'success' }),
      }).eligible,
    ).toBe(false)

    expect(
      getCertificateOverrideEligibility({
        result: createResult({ status: 'duplicate' }),
      }).eligible,
    ).toBe(false)
  })

  it('blocks extraction or load failures that did not reach validation', () => {
    const result = getCertificateOverrideEligibility({
      result: createResult({
        payload: {
          decision: {
            phase: 'extract',
            reasonCodes: ['ocr_failed'],
          },
        },
      }),
    })

    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('validation-phase')
  })

  it('blocks removed uploads', () => {
    const result = getCertificateOverrideEligibility({
      result: createResult(),
      removedFromBatchAt: new Date('2026-06-01T00:00:00.000Z'),
    })

    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('Removed uploads')
  })

  it('blocks existing pending and approved override requests', () => {
    expect(
      getCertificateOverrideEligibility({
        result: createResult(),
        existingRequests: [{ status: 'pending' }],
      }).eligible,
    ).toBe(false)

    expect(
      getCertificateOverrideEligibility({
        result: createResult(),
        existingRequests: [{ status: 'approved' }],
      }).eligible,
    ).toBe(false)
  })

  it('allows a new request after a rejected request', () => {
    const result = getCertificateOverrideEligibility({
      result: createResult(),
      existingRequests: [{ status: 'rejected' }],
    })

    expect(result).toEqual({ eligible: true, reason: null })
  })
})
