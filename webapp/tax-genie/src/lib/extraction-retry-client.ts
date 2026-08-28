import type {
  ExtractionRetryDisabledReason,
  ExtractionRetryView,
} from '@/lib/extraction-retry'
import type { OperationalDocumentView } from '@/lib/documents-types'

type RetryExtractionResponse = {
  retry?: {
    retryNumber: number
    status: 'queued'
  }
  error?: string
}

const disabledReasonMessages: Record<
  Exclude<ExtractionRetryDisabledReason, null | 'cooldown'>,
  string
> = {
  already_processing: 'Extraction is already queued or processing.',
  limit_reached: 'The maximum of three extraction retries has been reached.',
}

export const getExtractionRetryDisabledMessage = (
  retry: ExtractionRetryView,
) => {
  if (retry.disabledReason === 'cooldown') {
    return retry.cooldownUntil
      ? `Retry available after ${new Date(retry.cooldownUntil).toLocaleTimeString()}.`
      : 'Wait 60 seconds after the latest failure before retrying.'
  }

  if (retry.disabledReason) {
    return disabledReasonMessages[retry.disabledReason]
  }

  return null
}

export const isExtractionRetryActive = (
  retry: ExtractionRetryView | undefined,
) =>
  retry?.disabledReason === 'already_processing' ||
  retry?.disabledReason === 'cooldown'

export const queueGeminiExtractionRetry = async (
  document: OperationalDocumentView,
) => {
  const retry = document.extractionRetry
  if (!retry) {
    throw new Error('This document is not eligible for an extraction retry.')
  }

  const response = await fetch(
    `/api/documents/${encodeURIComponent(document.uploadId)}/retry-extraction`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sourceDocumentResultId: retry.sourceDocumentResultId,
        sourceExtractionAttemptId: retry.sourceExtractionAttemptId,
      }),
    },
  )
  const payload = (await response
    .json()
    .catch(() => null)) as RetryExtractionResponse | null

  if (!response.ok) {
    throw new Error(
      payload?.error ||
        `Unable to queue the extraction retry (${response.status}).`,
    )
  }

  if (response.status !== 202 || payload?.retry?.status !== 'queued') {
    throw new Error('The extraction retry was not queued.')
  }

  return payload.retry
}
