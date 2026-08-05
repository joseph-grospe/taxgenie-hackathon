import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OperationalDocumentView } from '@/lib/documents-types'
import {
  getExtractionRetryDisabledMessage,
  isExtractionRetryActive,
  queueGeminiExtractionRetry,
} from '@/lib/extraction-retry-client'

const document = {
  id: 'upload-1',
  uploadId: 'upload-1',
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

describe('Gemini extraction retry client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('queues the server-provided source result for the upload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          retry: {
            retryNumber: 1,
            status: 'queued',
          },
        }),
        {
          status: 202,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(queueGeminiExtractionRetry(document)).resolves.toEqual({
      retryNumber: 1,
      status: 'queued',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/documents/upload-1/retry-extraction',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceDocumentResultId: 38,
          sourceExtractionAttemptId: 104,
        }),
      },
    )
  })

  it('surfaces safe server conflict messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'Wait 60 seconds after the latest failure before retrying.',
          }),
          {
            status: 409,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    )

    await expect(queueGeminiExtractionRetry(document)).rejects.toThrow(
      'Wait 60 seconds after the latest failure before retrying.',
    )
  })

  it('does not infer eligibility when the server capability is absent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      queueGeminiExtractionRetry({
        ...document,
        extractionRetry: undefined,
      }),
    ).rejects.toThrow('not eligible')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('provides clear disabled-state messages', () => {
    expect(
      getExtractionRetryDisabledMessage({
        ...document.extractionRetry!,
        canRetry: false,
        disabledReason: 'already_processing',
      }),
    ).toBe('Extraction is already queued or processing.')
    expect(
      getExtractionRetryDisabledMessage({
        ...document.extractionRetry!,
        canRetry: false,
        disabledReason: 'limit_reached',
      }),
    ).toBe('The maximum of three extraction retries has been reached.')
  })

  it('polls only while a retry is cooling down or actively processing', () => {
    expect(
      isExtractionRetryActive({
        ...document.extractionRetry!,
        canRetry: false,
        disabledReason: 'already_processing',
      }),
    ).toBe(true)
    expect(
      isExtractionRetryActive({
        ...document.extractionRetry!,
        canRetry: false,
        disabledReason: 'cooldown',
      }),
    ).toBe(true)
    expect(isExtractionRetryActive(document.extractionRetry)).toBe(false)
    expect(isExtractionRetryActive(undefined)).toBe(false)
  })
})
