import { describe, expect, it } from 'vitest'

import {
  buildDocumentTrail,
  buildDocumentTrailDetails,
  buildReconciliationTrailStep,
  buildSigningTrailStep,
} from '@/lib/documents-server'

describe('document lifecycle trail helpers', () => {
  it('keeps validated persistence pending when validation rules fail', () => {
    const createdAt = new Date('2026-04-29T15:44:00.000Z')
    const fileRecord = {
      uploadStatus: 'uploaded',
      queueStatus: 'queued',
      processingStatus: 'error',
      errorMessage: null,
      uploadedAt: createdAt,
      createdAt,
      queuedAt: createdAt,
      processingFinishedAt: createdAt,
    } as Parameters<typeof buildDocumentTrail>[0]
    const jobRecord = {
      status: 'error',
      currentStep: 'complete',
      updatedAt: createdAt,
      finishedAt: createdAt,
    } as Parameters<typeof buildDocumentTrail>[1]
    const steps = [
      { stepName: 'load_input', status: 'success', createdAt },
      { stepName: 'extract_document', status: 'success', createdAt },
      { stepName: 'normalize_fields', status: 'success', createdAt },
      { stepName: 'check_masterlist', status: 'success', createdAt },
      {
        stepName: 'validate_rules',
        status: 'error',
        metadata: {
          phase: 'validate',
          route: 'error',
          reasonCodes: ['missing_printed_name', 'missing_signature'],
        },
        createdAt,
      },
      {
        stepName: 'persist_validation_fail',
        status: 'error',
        metadata: {
          phase: 'persist',
          route: 'error',
          reasonCodes: ['missing_printed_name', 'missing_signature'],
        },
        createdAt,
      },
      {
        stepName: 'finalize_workflow',
        status: 'error',
        metadata: {
          phase: 'persist',
          route: 'error',
          reasonCodes: ['missing_printed_name', 'missing_signature'],
        },
        createdAt,
      },
    ] as Parameters<typeof buildDocumentTrail>[4]
    const issueReason = 'Missing Printed Name; Missing Signature'

    const trail = buildDocumentTrail(
      fileRecord,
      jobRecord,
      'Error',
      issueReason,
      steps,
    )
    const details = buildDocumentTrailDetails(
      fileRecord,
      jobRecord,
      trail,
      issueReason,
      steps,
    )

    expect(trail).toEqual([
      { label: 'Uploaded', status: 'complete' },
      { label: 'Queued', status: 'complete' },
      { label: 'OCR / Layout', status: 'complete' },
      { label: 'AI Normalize', status: 'complete' },
      { label: 'Masterlist Check', status: 'complete' },
      { label: 'Validation + Variance', status: 'error' },
      { label: 'Deduplication', status: 'pending' },
      { label: 'Rename + Persist', status: 'pending' },
      { label: 'Reconciliation', status: 'pending' },
      { label: 'Signing', status: 'pending' },
    ])
    expect(
      details.find((detail) => detail.label === 'Validation + Variance'),
    ).toMatchObject({
      status: 'error',
      description: issueReason,
    })
    expect(
      details.find((detail) => detail.label === 'Rename + Persist'),
    ).toMatchObject({
      timestamp: '—',
      status: 'pending',
      description: 'Waiting for rename + persist.',
    })
  })

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
