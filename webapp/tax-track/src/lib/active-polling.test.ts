import { describe, expect, it } from 'vitest'

import {
  hasActiveBatchProcessing,
  hasActiveLocalUploads,
  shouldPollBatchDetail,
  shouldPollUploadIntake,
} from '@/lib/active-polling'

describe('active polling helpers', () => {
  it('polls upload intake for active local upload states', () => {
    expect(
      hasActiveLocalUploads([
        { status: 'Done' },
        { status: 'Queued' },
        { status: 'Duplicate' },
      ]),
    ).toBe(true)

    expect(
      hasActiveLocalUploads([
        { status: 'Done' },
        { status: 'Duplicate' },
        { status: 'Error' },
      ]),
    ).toBe(false)
  })

  it('polls upload intake for active server-side batch work', () => {
    expect(
      shouldPollUploadIntake({
        activeBatch: {
          counts: {
            pending: 0,
            uploaded: 1,
            queued: 0,
            processing: 0,
          },
        },
        localFiles: [{ status: 'Done' }],
      }),
    ).toBe(true)
  })

  it('stops upload intake polling for terminal local and server states', () => {
    expect(
      shouldPollUploadIntake({
        activeBatch: {
          counts: {
            pending: 0,
            uploaded: 0,
            queued: 0,
            processing: 0,
          },
        },
        localFiles: [
          { status: 'Done' },
          { status: 'Duplicate' },
          { status: 'Error' },
        ],
      }),
    ).toBe(false)
  })

  it('polls batch detail while processing counts are non-terminal', () => {
    expect(
      hasActiveBatchProcessing({
        counts: {
          pending: 0,
          uploaded: 0,
          queued: 2,
          processing: 0,
        },
      }),
    ).toBe(true)

    expect(
      shouldPollBatchDetail({
        counts: {
          pending: 0,
          uploaded: 0,
          queued: 0,
          processing: 3,
        },
      }),
    ).toBe(true)
  })

  it('stops batch detail polling for terminal counts', () => {
    expect(
      shouldPollBatchDetail({
        counts: {
          pending: 0,
          uploaded: 0,
          queued: 0,
          processing: 0,
        },
      }),
    ).toBe(false)
  })
})
