import { describe, expect, it } from 'vitest'

import { shouldUseHistoryBackForDocumentReferrer } from '@/lib/document-navigation'

describe('shouldUseHistoryBackForDocumentReferrer', () => {
  it('returns false when there is no referrer', () => {
    expect(
      shouldUseHistoryBackForDocumentReferrer('', 'http://localhost:3000'),
    ).toBe(false)
  })

  it('returns false for signing-page referrers to avoid looping back into signing', () => {
    expect(
      shouldUseHistoryBackForDocumentReferrer(
        'http://localhost:3000/documents/upload-1/sign',
        'http://localhost:3000',
      ),
    ).toBe(false)
  })

  it('returns true for same-origin non-signing referrers', () => {
    expect(
      shouldUseHistoryBackForDocumentReferrer(
        'http://localhost:3000/validated',
        'http://localhost:3000',
      ),
    ).toBe(true)
  })

  it('returns false for cross-origin referrers', () => {
    expect(
      shouldUseHistoryBackForDocumentReferrer(
        'https://example.com/validated',
        'http://localhost:3000',
      ),
    ).toBe(false)
  })
})
