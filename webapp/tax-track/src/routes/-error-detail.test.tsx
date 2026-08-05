/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OperationalDocumentView } from '@/lib/documents-types'
import {
  BlockingErrorCard,
  ValidationChecksEmptyState,
} from '@/routes/error-detail'

const retryableDocument = {
  id: 'upload-1',
  uploadId: 'upload-1',
  fileName: 'bir-2307.pdf',
  status: 'Error',
  stage: 'Document processing failed',
  issueReason: 'The document processing service was temporarily unavailable.',
  payee: 'Not available',
  period: 'Not available',
  atc: 'Not available',
  owner: 'TaxTrack Admin',
  errors: [
    {
      code: 'Document processing',
      stage: 'Temporarily unavailable',
      message:
        'We couldn’t process this document right now. Please try again in a few minutes.',
    },
  ],
  validationChecksEmptyMessage:
    'Validation checks could not run because document processing did not finish.',
  extractionRetry: {
    provider: 'gemini',
    sourceDocumentResultId: 38,
    sourceExtractionAttemptId: 104,
    reasonCodes: ['gemini_http_503'],
    canRetry: true,
    retryCount: 0,
    maxRetries: 3,
    cooldownUntil: null,
    disabledReason: null,
  },
} as OperationalDocumentView

describe('Error Review extraction retry', () => {
  afterEach(() => {
    cleanup()
  })

  it('places the retry action in the Blocking Error card', () => {
    const onRetry = vi.fn()
    render(
      <BlockingErrorCard
        document={retryableDocument}
        error={retryableDocument.errors[0]}
        onRetryExtraction={onRetry}
      />,
    )

    expect(screen.getByText('Blocking error')).toBeTruthy()
    expect(
      screen.getByText(
        'We couldn’t process this document right now. Please try again in a few minutes.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('Document processing · Temporarily unavailable'),
    ).toBeTruthy()
    expect(screen.getByText('Document processing failed')).toBeTruthy()
    expect(screen.getAllByText('Not available')).toHaveLength(3)
    expect(screen.queryByText(/gemini|503/iu)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry extraction' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('explains why validation checks are unavailable', () => {
    render(
      <ValidationChecksEmptyState
        message={retryableDocument.validationChecksEmptyMessage}
      />,
    )

    expect(
      screen.getByText(
        'Validation checks could not run because document processing did not finish.',
      ),
    ).toBeTruthy()
  })

  it('does not render retry without server eligibility', () => {
    const document = {
      ...retryableDocument,
      extractionRetry: undefined,
    }
    render(<BlockingErrorCard document={document} error={document.errors[0]} />)

    expect(
      screen.queryByRole('button', { name: 'Retry extraction' }),
    ).toBeNull()
  })
})
