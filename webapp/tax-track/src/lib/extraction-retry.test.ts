import { describe, expect, it } from 'vitest'

import {
  EXTRACTION_RETRY_COOLDOWN_MS,
  MAX_MANUAL_EXTRACTION_RETRIES,
  RETRYABLE_GEMINI_REASON_CODES,
  buildExtractionRetryView,
  buildManualExtractionRetryRevision,
  getManualExtractionRetryNumber,
  isRetryableGeminiFailure,
} from '@/lib/extraction-retry'

const failure = (overrides: Record<string, unknown> = {}) => ({
  id: 38,
  currentExtractionAttemptId: 104,
  status: 'error',
  payload: null,
  certificateCount: 0,
  reasonCodes: ['gemini_http_503'],
  revision: 'etag-1',
  createdAt: new Date('2026-07-27T07:00:00.000Z'),
  ...overrides,
})

const file = (overrides: Record<string, unknown> = {}) => ({
  queueStatus: 'failed',
  processingStatus: 'error',
  revision: 'etag-1',
  ...overrides,
})

const attempt = (overrides: Record<string, unknown> = {}) => ({
  id: 104,
  retryNumber: 0,
  status: 'failed',
  startedAt: new Date('2026-07-27T06:59:00.000Z'),
  finishedAt: new Date('2026-07-27T07:00:00.000Z'),
  ...overrides,
})

describe('Gemini extraction retry eligibility', () => {
  it.each(RETRYABLE_GEMINI_REASON_CODES)(
    'allows the transient reason code %s',
    (reasonCode) => {
      expect(
        isRetryableGeminiFailure(failure({ reasonCodes: [reasonCode] })),
      ).toBe(true)
    },
  )

  it.each(
    [
      ['gemini_invalid_response'],
      ['invalid_pdf'],
      ['validation_failed'],
      ['duplicate'],
      ['non_bir_2307'],
      ['gemini_http_503', 'gemini_invalid_response'],
    ].map((reasonCodes) => [reasonCodes]),
  )('rejects non-transport and mixed reason codes: %j', (reasonCodes) => {
    expect(isRetryableGeminiFailure(failure({ reasonCodes }))).toBe(false)
  })

  it('rejects payload-bearing, certificate-bearing, and non-error results', () => {
    expect(
      isRetryableGeminiFailure(failure({ payload: { schemaVersion: 1 } })),
    ).toBe(false)
    expect(isRetryableGeminiFailure(failure({ certificateCount: 1 }))).toBe(
      false,
    )
    expect(isRetryableGeminiFailure(failure({ status: 'accepted' }))).toBe(
      false,
    )
  })

  it('enforces the 60-second cooldown', () => {
    const latestResult = failure()
    const retry = buildExtractionRetryView({
      latestResult,
      extractionAttempts: [attempt()],
      file: file(),
      now: new Date(
        attempt().finishedAt.getTime() + EXTRACTION_RETRY_COOLDOWN_MS - 1,
      ),
    })

    expect(retry).toMatchObject({
      canRetry: false,
      disabledReason: 'cooldown',
      retryCount: 0,
      maxRetries: MAX_MANUAL_EXTRACTION_RETRIES,
    })
    expect(retry?.cooldownUntil).toBe('2026-07-27T07:01:00.000Z')
  })

  it('allows retrying when the cooldown has elapsed', () => {
    const latestResult = failure()

    expect(
      buildExtractionRetryView({
        latestResult,
        extractionAttempts: [attempt()],
        file: file(),
        now: new Date(
          attempt().finishedAt.getTime() + EXTRACTION_RETRY_COOLDOWN_MS,
        ),
      }),
    ).toMatchObject({
      canRetry: true,
      disabledReason: null,
      cooldownUntil: null,
    })
  })

  it.each([
    { queueStatus: 'sending', processingStatus: 'pending' },
    { queueStatus: 'queued', processingStatus: 'pending' },
    { queueStatus: 'failed', processingStatus: 'processing' },
  ])('blocks a retry while the upload is active: %j', (state) => {
    expect(
      buildExtractionRetryView({
        latestResult: failure(),
        extractionAttempts: [attempt()],
        file: file(state),
        now: new Date('2026-07-27T07:02:00.000Z'),
      }),
    ).toMatchObject({
      canRetry: false,
      disabledReason: 'already_processing',
    })
  })

  it('allows retry after worker failure even when the historical queue state remains queued', () => {
    expect(
      buildExtractionRetryView({
        latestResult: failure(),
        extractionAttempts: [attempt()],
        file: file({
          queueStatus: 'queued',
          processingStatus: 'error',
        }),
        now: new Date('2026-07-27T07:02:00.000Z'),
      }),
    ).toMatchObject({
      canRetry: true,
      disabledReason: null,
    })
  })

  it('derives retry count from internal attempts and active intake revision', () => {
    const revisions = [
      'etag-1',
      'manual-retry-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'manual-retry-3-cccccccc-cccc-cccc-cccc-cccccccccccc',
    ]

    expect(getManualExtractionRetryNumber(revisions)).toBe(3)
    expect(
      buildExtractionRetryView({
        latestResult: failure({
          currentExtractionAttemptId: 106,
        }),
        extractionAttempts: [
          attempt(),
          attempt({
            id: 105,
            retryNumber: 1,
            finishedAt: new Date('2026-07-27T05:00:00.000Z'),
          }),
          attempt({
            id: 106,
            retryNumber: 2,
            finishedAt: new Date('2026-07-27T06:00:00.000Z'),
          }),
        ],
        file: file({ revision: revisions.at(-1) }),
        now: new Date('2026-07-27T07:02:00.000Z'),
      }),
    ).toMatchObject({
      retryCount: 3,
      canRetry: false,
      disabledReason: 'limit_reached',
    })
  })

  it('rejects stale or still-processing current attempts', () => {
    expect(
      buildExtractionRetryView({
        latestResult: failure(),
        extractionAttempts: [attempt({ id: 103 })],
        file: file(),
        now: new Date('2026-07-27T07:02:00.000Z'),
      }),
    ).toBeUndefined()
    expect(
      buildExtractionRetryView({
        latestResult: failure(),
        extractionAttempts: [attempt({ status: 'processing' })],
        file: file(),
        now: new Date('2026-07-27T07:02:00.000Z'),
      }),
    ).toBeUndefined()
  })

  it('builds a unique worker-visible revision', () => {
    expect(
      buildManualExtractionRetryRevision(
        2,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      ),
    ).toBe('manual-retry-2-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
  })
})
