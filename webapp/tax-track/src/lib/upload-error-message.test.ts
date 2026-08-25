import { describe, expect, it } from 'vitest'

import {
  RETRYABLE_GEMINI_RESPONSE_REASON_CODES,
  RETRYABLE_GEMINI_TRANSPORT_REASON_CODES,
} from '@/lib/extraction-retry'
import {
  EXTRACTION_RESPONSE_FAILURE_MESSAGE,
  INVALID_PDF_FAILURE_MESSAGE,
  TEMPORARY_PROCESSING_FAILURE_MESSAGE,
  formatUploadErrorDetail,
} from '@/lib/upload-error-message'

describe('formatUploadErrorDetail', () => {
  it.each(RETRYABLE_GEMINI_TRANSPORT_REASON_CODES)(
    'replaces the transport reason %s with a user-friendly message',
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

  it.each(RETRYABLE_GEMINI_RESPONSE_REASON_CODES)(
    'replaces the extraction response reason %s with retry guidance',
    (reasonCode) => {
      const detail = formatUploadErrorDetail([reasonCode])

      expect(detail).toBe(EXTRACTION_RESPONSE_FAILURE_MESSAGE)
      expect(detail?.toLowerCase()).not.toContain('gemini')
    },
  )

  it('replaces invalid PDF details with clean-export guidance', () => {
    expect(formatUploadErrorDetail(['invalid_pdf'])).toBe(
      INVALID_PDF_FAILURE_MESSAGE,
    )
  })

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
