/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExtractionRetryView } from '@/lib/extraction-retry'
import { ValidationSection } from '@/components/document-detail-drawer'

const retry: ExtractionRetryView = {
  provider: 'gemini',
  sourceDocumentResultId: 38,
  sourceExtractionAttemptId: 104,
  reasonCodes: ['gemini_http_503'],
  canRetry: true,
  retryCount: 0,
  maxRetries: 3,
  cooldownUntil: null,
  disabledReason: null,
}

describe('Document detail drawer retry action', () => {
  afterEach(() => {
    cleanup()
  })

  it('places the labeled retry action after the provider error', () => {
    const onRetry = vi.fn()
    render(
      <ValidationSection
        meta={[]}
        errors={[
          {
            code: 'gemini_http_503',
            stage: 'Agent extraction',
            message: 'The extraction provider was temporarily unavailable.',
          },
        ]}
        extractionRetry={retry}
        isRetryingExtraction={false}
        onRetryExtraction={onRetry}
      />,
    )

    const error = screen.getByText(
      'The extraction provider was temporarily unavailable.',
    )
    const button = screen.getByRole('button', { name: 'Retry extraction' })
    expect(
      error.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    fireEvent.click(button)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders no retry action without a server capability', () => {
    render(
      <ValidationSection meta={[]} errors={[]} isRetryingExtraction={false} />,
    )

    expect(
      screen.queryByRole('button', { name: 'Retry extraction' }),
    ).toBeNull()
  })
})
