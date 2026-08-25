import {
  RETRYABLE_GEMINI_RESPONSE_REASON_CODES,
  RETRYABLE_GEMINI_TRANSPORT_REASON_CODES,
} from '@/lib/extraction-retry'

export const TEMPORARY_PROCESSING_FAILURE_MESSAGE =
  'We couldn’t process this document right now. Please try again in a few minutes.'
export const TEMPORARY_PROCESSING_ISSUE_REASON =
  'The document processing service was temporarily unavailable.'
export const TEMPORARY_PROCESSING_VALIDATION_MESSAGE =
  'Validation checks could not run because document processing did not finish.'
export const TEMPORARY_PROCESSING_UNAVAILABLE_VALUE = 'Not available'

export const EXTRACTION_RESPONSE_FAILURE_MESSAGE =
  'We couldn’t read a valid extraction response. Retry document processing.'
export const EXTRACTION_RESPONSE_ISSUE_REASON =
  'The document extraction service returned an unusable response.'
export const EXTRACTION_RESPONSE_VALIDATION_MESSAGE =
  'Validation checks could not run because document extraction did not return a usable response.'

export const INVALID_PDF_FAILURE_MESSAGE =
  'Upload a clean PDF exported from the source system.'
export const INVALID_PDF_ISSUE_REASON =
  'The uploaded file is damaged or is not a valid PDF.'
export const INVALID_PDF_VALIDATION_MESSAGE =
  'Validation checks could not run because the uploaded PDF could not be read.'

export const GENERIC_PROCESSING_FAILURE_MESSAGE =
  'The document could not be processed. Review the processing details or replace the source file.'
export const GENERIC_PROCESSING_ISSUE_REASON =
  'Document processing ended with an error.'
export const GENERIC_PROCESSING_VALIDATION_MESSAGE =
  'Validation checks could not run because document processing ended with an error.'

const temporaryProcessingReasonCodes = new Set<string>(
  RETRYABLE_GEMINI_TRANSPORT_REASON_CODES,
)
const extractionResponseReasonCodes = new Set<string>(
  RETRYABLE_GEMINI_RESPONSE_REASON_CODES,
)

export const hasTemporaryProcessingFailureReason = (
  reasonCodes: ReadonlyArray<string>,
) =>
  reasonCodes.some((reasonCode) =>
    temporaryProcessingReasonCodes.has(reasonCode),
  )

export const hasExtractionResponseFailureReason = (
  reasonCodes: ReadonlyArray<string>,
) =>
  reasonCodes.some((reasonCode) =>
    extractionResponseReasonCodes.has(reasonCode),
  )

export type TerminalProcessingFailurePresentation = {
  category: 'invalid_pdf' | 'gemini_response' | 'temporary' | 'generic'
  stage: string
  nextStep: string
  issueReason: string
  unavailableValue: string
  validationChecksEmptyMessage: string
  errorCode: string
  errorStage: string
  errorMessage: string
}

export const resolveTerminalProcessingFailurePresentation = (
  reasonCodes: ReadonlyArray<string>,
  options: { includeGeneric?: boolean } = {},
): TerminalProcessingFailurePresentation | null => {
  if (reasonCodes.includes('invalid_pdf')) {
    return {
      category: 'invalid_pdf',
      stage: 'PDF validation failed',
      nextStep: 'Replace source PDF',
      issueReason: INVALID_PDF_ISSUE_REASON,
      unavailableValue: TEMPORARY_PROCESSING_UNAVAILABLE_VALUE,
      validationChecksEmptyMessage: INVALID_PDF_VALIDATION_MESSAGE,
      errorCode: 'PDF validation',
      errorStage: 'Invalid PDF',
      errorMessage: INVALID_PDF_FAILURE_MESSAGE,
    }
  }

  if (hasExtractionResponseFailureReason(reasonCodes)) {
    return {
      category: 'gemini_response',
      stage: 'Document processing failed',
      nextStep: 'Retry document processing',
      issueReason: EXTRACTION_RESPONSE_ISSUE_REASON,
      unavailableValue: TEMPORARY_PROCESSING_UNAVAILABLE_VALUE,
      validationChecksEmptyMessage: EXTRACTION_RESPONSE_VALIDATION_MESSAGE,
      errorCode: 'Document extraction',
      errorStage: 'Invalid extraction response',
      errorMessage: EXTRACTION_RESPONSE_FAILURE_MESSAGE,
    }
  }

  if (hasTemporaryProcessingFailureReason(reasonCodes)) {
    return {
      category: 'temporary',
      stage: 'Document processing failed',
      nextStep: 'Retry document processing',
      issueReason: TEMPORARY_PROCESSING_ISSUE_REASON,
      unavailableValue: TEMPORARY_PROCESSING_UNAVAILABLE_VALUE,
      validationChecksEmptyMessage: TEMPORARY_PROCESSING_VALIDATION_MESSAGE,
      errorCode: 'Document processing',
      errorStage: 'Temporarily unavailable',
      errorMessage: TEMPORARY_PROCESSING_FAILURE_MESSAGE,
    }
  }

  const hasGeminiFailure = reasonCodes.some((reasonCode) =>
    reasonCode.startsWith('gemini_'),
  )
  if (!hasGeminiFailure && !options.includeGeneric) {
    return null
  }
  if (reasonCodes.length === 0 && !options.includeGeneric) {
    return null
  }

  return {
    category: 'generic',
    stage: 'Document processing failed',
    nextStep: 'Review processing error',
    issueReason: GENERIC_PROCESSING_ISSUE_REASON,
    unavailableValue: TEMPORARY_PROCESSING_UNAVAILABLE_VALUE,
    validationChecksEmptyMessage: GENERIC_PROCESSING_VALIDATION_MESSAGE,
    errorCode: 'Document processing',
    errorStage: 'Processing error',
    errorMessage: GENERIC_PROCESSING_FAILURE_MESSAGE,
  }
}

export const formatUploadErrorDetail = (
  reasonCodes: ReadonlyArray<string>,
): string | null => {
  const terminalFailure = resolveTerminalProcessingFailurePresentation(
    reasonCodes,
    { includeGeneric: false },
  )
  if (terminalFailure) {
    return terminalFailure.errorMessage
  }

  const reviewReason = reasonCodes
    .map((reasonCode) => reasonCode.replace(/[_-]+/g, ' '))
    .join(', ')

  return reviewReason ? `Error reasons: ${reviewReason}.` : null
}
