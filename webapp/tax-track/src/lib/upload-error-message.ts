import { RETRYABLE_GEMINI_REASON_CODES } from '@/lib/extraction-retry'

export const TEMPORARY_PROCESSING_FAILURE_MESSAGE =
  'We couldn’t process this document right now. Please try again in a few minutes.'
export const TEMPORARY_PROCESSING_ISSUE_REASON =
  'The document processing service was temporarily unavailable.'
export const TEMPORARY_PROCESSING_VALIDATION_MESSAGE =
  'Validation checks could not run because document processing did not finish.'
export const TEMPORARY_PROCESSING_UNAVAILABLE_VALUE = 'Not available'

const temporaryProcessingReasonCodes = new Set<string>(
  RETRYABLE_GEMINI_REASON_CODES,
)

export const hasTemporaryProcessingFailureReason = (
  reasonCodes: ReadonlyArray<string>,
) =>
  reasonCodes.some((reasonCode) =>
    temporaryProcessingReasonCodes.has(reasonCode),
  )

export const formatUploadErrorDetail = (
  reasonCodes: ReadonlyArray<string>,
): string | null => {
  if (hasTemporaryProcessingFailureReason(reasonCodes)) {
    return TEMPORARY_PROCESSING_FAILURE_MESSAGE
  }

  const reviewReason = reasonCodes
    .map((reasonCode) => reasonCode.replace(/[_-]+/g, ' '))
    .join(', ')

  return reviewReason ? `Error reasons: ${reviewReason}.` : null
}
