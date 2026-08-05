import { describe, expect, it } from 'vitest'

import { RETRYABLE_GEMINI_REASON_CODES } from '@/lib/extraction-retry'
import {
  TEMPORARY_PROCESSING_FAILURE_MESSAGE,
  formatUploadErrorDetail,
} from '@/lib/upload-error-message'

describe('formatUploadErrorDetail', () => {
  it.each(RETRYABLE_GEMINI_REASON_CODES)(
    'replaces the temporary reason %s with a user-friendly message',
    (reasonCode) => {
      const detail = formatUploadErrorDetail([reasonCode])
      const statusCode = reasonCode.match(/\d{3}/u)?.[0]

      expect(detail).toBe(TEMPORARY_PROCESSING_FAILURE_MESSAGE)
      expect(detail).not.toContain('Error reasons')
      expect(detail?.toLowerCase()).not.toContain('gemini')
      if (statusCode) {
        expect(detail).not.toContain(statusCode)
      }
    },
  )

  it('gives the friendly message precedence over other reason codes', () => {
    expect(
      formatUploadErrorDetail(['missing_signature', 'gemini_http_503']),
    ).toBe(TEMPORARY_PROCESSING_FAILURE_MESSAGE)
  })

  it('preserves the existing formatting for unrelated reason codes', () => {
    expect(
      formatUploadErrorDetail(['missing_signature', 'variance-exceeded']),
    ).toBe('Error reasons: missing signature, variance exceeded.')
  })

  it('returns no detail when there are no reason codes', () => {
    expect(formatUploadErrorDetail([])).toBeNull()
  })
})
