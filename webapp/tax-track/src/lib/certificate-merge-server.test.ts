import { afterEach, describe, expect, it } from 'vitest'

import { shouldSkipAwsBatchMergeSubmission } from '@/lib/certificate-merge-server'

describe('certificate merge server env flags', () => {
  const originalValue = process.env.MERGE_JOBS_SKIP_AWS_BATCH

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.MERGE_JOBS_SKIP_AWS_BATCH
    } else {
      process.env.MERGE_JOBS_SKIP_AWS_BATCH = originalValue
    }
  })

  it.each(['1', 'true', 'TRUE', 'yes', 'on'])(
    'skips AWS Batch merge submission when MERGE_JOBS_SKIP_AWS_BATCH=%s',
    (value) => {
      process.env.MERGE_JOBS_SKIP_AWS_BATCH = value

      expect(shouldSkipAwsBatchMergeSubmission()).toBe(true)
    },
  )

  it.each([undefined, '', '0', 'false', 'no', 'off'])(
    'keeps AWS Batch merge submission enabled when MERGE_JOBS_SKIP_AWS_BATCH=%s',
    (value) => {
      if (value === undefined) {
        delete process.env.MERGE_JOBS_SKIP_AWS_BATCH
      } else {
        process.env.MERGE_JOBS_SKIP_AWS_BATCH = value
      }

      expect(shouldSkipAwsBatchMergeSubmission()).toBe(false)
    },
  )
})
