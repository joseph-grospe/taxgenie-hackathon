import { describe, expect, it } from 'vitest'

import {
  createCertificateOverrideRequestSchema,
  getCertificateOverrideEligibility,
} from '@/lib/certificate-override-server'

const createResult = (
  overrides: Record<string, unknown> = {},
): Parameters<typeof getCertificateOverrideEligibility>[0]['result'] =>
  ({
    id: 1,
    reasonCodes: [],
    status: 'error',
    validationStatus: 'invalid',
    ...overrides,
  }) as unknown as Parameters<
    typeof getCertificateOverrideEligibility
  >[0]['result']

describe('certificate override eligibility', () => {
  it('allows accepted, manual-review, and error extracted certificates', () => {
    expect(
      getCertificateOverrideEligibility({ result: createResult() }),
    ).toEqual({ eligible: true, reason: null })
    expect(
      getCertificateOverrideEligibility({
        result: createResult({
          status: 'accepted',
          validationStatus: 'valid',
        }),
      }),
    ).toEqual({ eligible: true, reason: null })
    expect(
      getCertificateOverrideEligibility({
        result: createResult({
          status: 'manual_review',
          validationStatus: 'manual_review',
        }),
      }),
    ).toEqual({ eligible: true, reason: null })
  })

  it('blocks duplicates and removed uploads', () => {
    expect(
      getCertificateOverrideEligibility({
        result: createResult({ status: 'duplicate' }),
      }).eligible,
    ).toBe(false)
    expect(
      getCertificateOverrideEligibility({
        result: createResult(),
        removedFromBatchAt: new Date('2026-06-01T00:00:00.000Z'),
      }).reason,
    ).toContain('Removed uploads')
  })

  it('blocks corrections for files containing multiple certificates', () => {
    expect(
      getCertificateOverrideEligibility({
        result: createResult({
          reasonCodes: ['multiple_certificates_detected'],
        }),
      }),
    ).toEqual({
      eligible: false,
      reason:
        'This file contains multiple certificates. Upload each certificate as a separate PDF to make corrections.',
    })
  })

  it('blocks only an existing pending request', () => {
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
    ).toBe(true)
    expect(
      getCertificateOverrideEligibility({
        result: createResult(),
        existingRequests: [{ status: 'rejected' }],
      }).eligible,
    ).toBe(true)
  })

  it('requires strict, unique, supported correction changes', () => {
    expect(
      createCertificateOverrideRequestSchema.safeParse({
        certificateId: 42,
        requestNote: 'Correct the extracted total.',
        changes: [
          {
            fieldPath: 'totals.taxWithheld',
            proposedValue: '24.01',
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      createCertificateOverrideRequestSchema.safeParse({
        certificateId: 42,
        requestNote: 'Attempt to rewrite extraction.',
        changes: [
          {
            fieldPath: 'payload.extraction',
            proposedValue: 'forbidden',
          },
        ],
      }).success,
    ).toBe(false)
  })
})
