/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExtractionRetryView } from '@/lib/extraction-retry'
import { ExtractionRetryAction } from '@/components/extraction-retry-action'

const retry: ExtractionRetryView = {
  provider: 'gemini',
  sourceDocumentResultId: 38,
  sourceExtractionAttemptId: 104,
  reasonCodes: ['gemini_http_503'],
  canRetry: true,
  retryCount: 1,
  maxRetries: 3,
  cooldownUntil: null,
  disabledReason: null,
}

describe('ExtractionRetryAction', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the next retry number and submits once', () => {
    const onRetry = vi.fn()
    render(<ExtractionRetryAction retry={retry} onRetry={onRetry} />)

    fireEvent.click(screen.getByRole('button', { name: 'Retry extraction' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText('Retry 2 of 3 · Uses the original PDF.'),
    ).toBeTruthy()
  })

  it('shows a disabled queueing state', () => {
    render(<ExtractionRetryAction retry={retry} isRetrying onRetry={vi.fn()} />)

    const button = screen.getByRole('button', {
      name: 'Queueing retry',
    })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('shows the queued state and processing explanation', () => {
    render(
      <ExtractionRetryAction
        retry={{
          ...retry,
          canRetry: false,
          disabledReason: 'already_processing',
        }}
        onRetry={vi.fn()}
      />,
    )

    const button = screen.getByRole('button', {
      name: 'Extraction queued',
    })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(
      screen.getByText('Extraction is already queued or processing.'),
    ).toBeTruthy()
  })

  it.each([
    {
      disabledReason: 'cooldown' as const,
      cooldownUntil: '2026-07-28T01:02:03.000Z',
      expected: 'Retry available after',
    },
    {
      disabledReason: 'limit_reached' as const,
      cooldownUntil: null,
      expected: 'The maximum of three extraction retries has been reached.',
    },
  ])(
    'shows the $disabledReason explanation',
    ({ disabledReason, cooldownUntil, expected }) => {
      render(
        <ExtractionRetryAction
          retry={{
            ...retry,
            canRetry: false,
            retryCount: disabledReason === 'limit_reached' ? 3 : 1,
            disabledReason,
            cooldownUntil,
          }}
          onRetry={vi.fn()}
        />,
      )

      expect(screen.getByText(expected, { exact: false })).toBeTruthy()
    },
  )
})
