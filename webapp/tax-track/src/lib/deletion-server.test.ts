import { describe, expect, it } from 'vitest'

import {
  resolveBatchDeletionEligibility,
  resolveUploadDeletionEligibility,
} from '@/lib/deletion-server'

type UploadInput = Parameters<typeof resolveUploadDeletionEligibility>[0]

const upload = (
  processingStatus: string,
  overrides: Record<string, unknown> = {},
) =>
  ({
    uploadStatus: 'uploaded',
    queueStatus: 'queued',
    processingStatus,
    purgeStatus: null,
    ...overrides,
  }) as unknown as UploadInput

describe('deletion eligibility', () => {
  it.each(['success', 'duplicate', 'error'])(
    'allows terminal unsigned %s files',
    (processingStatus) => {
      expect(
        resolveUploadDeletionEligibility(upload(processingStatus), {
          batchDeleted: false,
          hasSignedCertificate: false,
          hasMergeInput: false,
        }),
      ).toMatchObject({ canDelete: true, code: 'eligible' })
    },
  )

  it('blocks files that are still processing', () => {
    expect(
      resolveUploadDeletionEligibility(upload('processing'), {
        batchDeleted: false,
        hasSignedCertificate: false,
        hasMergeInput: false,
      }),
    ).toMatchObject({ canDelete: false, code: 'processing' })
  })

  it('blocks signed artifacts but not failed signing attempts', () => {
    expect(
      resolveUploadDeletionEligibility(upload('success'), {
        batchDeleted: false,
        hasSignedCertificate: true,
        hasMergeInput: false,
      }),
    ).toMatchObject({ canDelete: false, code: 'signed' })
    expect(
      resolveUploadDeletionEligibility(upload('success'), {
        batchDeleted: false,
        hasSignedCertificate: false,
        hasMergeInput: false,
      }),
    ).toMatchObject({ canDelete: true })
  })

  it('blocks every certificate represented by a merge input', () => {
    expect(
      resolveUploadDeletionEligibility(upload('success'), {
        batchDeleted: false,
        hasSignedCertificate: false,
        hasMergeInput: true,
      }),
    ).toMatchObject({ canDelete: false, code: 'merged' })
  })

  it('blocks individual deletion for Recently Deleted batches', () => {
    expect(
      resolveUploadDeletionEligibility(upload('success'), {
        batchDeleted: true,
        hasSignedCertificate: false,
        hasMergeInput: false,
      }),
    ).toMatchObject({ canDelete: false, code: 'batch_deleted' })
  })

  it('blocks duplicate submissions while a purge is queued or running', () => {
    for (const purgeStatus of ['queued', 'running']) {
      expect(
        resolveUploadDeletionEligibility(upload('success', { purgeStatus }), {
          batchDeleted: false,
          hasSignedCertificate: false,
          hasMergeInput: false,
        }),
      ).toMatchObject({ canDelete: false, code: 'purge_in_progress' })
    }
  })

  it('protects mixed batches and batches with incomplete file purges', () => {
    expect(
      resolveBatchDeletionEligibility({
        hasSignedCertificate: true,
        hasMergeInput: false,
        hasFilePurge: false,
      }),
    ).toMatchObject({ canDelete: false, code: 'signed' })
    expect(
      resolveBatchDeletionEligibility({
        hasSignedCertificate: false,
        hasMergeInput: false,
        hasFilePurge: true,
      }),
    ).toMatchObject({ canDelete: false, code: 'purge_in_progress' })
  })

  it('reports queued and running batch purges as in progress', () => {
    for (const purgeStatus of ['queued', 'running'] as const) {
      expect(
        resolveBatchDeletionEligibility({
          purgeStatus,
          hasSignedCertificate: false,
          hasMergeInput: false,
          hasFilePurge: false,
        }),
      ).toMatchObject({ canDelete: false, code: 'purge_in_progress' })
    }
  })
})
