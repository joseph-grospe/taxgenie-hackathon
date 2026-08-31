import { afterEach, describe, expect, it, vi } from 'vitest'

import { shouldSkipMergeProviderSubmission } from '@/lib/certificate-merge-server'

describe('certificate merge feature boundary', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each(['1', 'true', 'TRUE', 'yes', 'on'])(
    'permits a future provider when TAXGENIE_ENABLE_MERGE=%s',
    (value) => {
      vi.stubEnv('TAXGENIE_ENABLE_MERGE', value)
      expect(shouldSkipMergeProviderSubmission()).toBe(false)
    },
  )

  it.each([undefined, '', '0', 'false', 'no', 'off'])(
    'skips provider submission when TAXGENIE_ENABLE_MERGE=%s',
    (value) => {
      vi.stubEnv('TAXGENIE_ENABLE_MERGE', value ?? '')
      expect(shouldSkipMergeProviderSubmission()).toBe(true)
    },
  )
})
