export const RETRYABLE_GEMINI_REASON_CODES = [
  'gemini_http_429',
  'gemini_http_500',
  'gemini_http_502',
  'gemini_http_503',
  'gemini_http_504',
  'gemini_timeout',
] as const

export const MAX_MANUAL_EXTRACTION_RETRIES = 3
export const EXTRACTION_RETRY_COOLDOWN_MS = 60_000

export type ExtractionRetryDisabledReason =
  | 'cooldown'
  | 'limit_reached'
  | 'already_processing'
  | null

export type ExtractionRetryView = {
  provider: 'gemini'
  sourceDocumentResultId: number
  sourceExtractionAttemptId: number
  reasonCodes: Array<string>
  canRetry: boolean
  retryCount: number
  maxRetries: number
  cooldownUntil: string | null
  disabledReason: ExtractionRetryDisabledReason
}

type ExtractionRetryResult = {
  id: number
  currentExtractionAttemptId: number
  status: string
  payload: unknown
  certificateCount: number
  reasonCodes: unknown
  revision: string
  createdAt: Date
}

type ExtractionRetryAttempt = {
  id: number
  retryNumber: number
  status: string
  startedAt: Date
  finishedAt: Date | null
}

type ExtractionRetryFileState = {
  queueStatus: string
  processingStatus: string
  revision: string | null
}

const retryableReasonCodes = new Set<string>(RETRYABLE_GEMINI_REASON_CODES)
const manualRetryRevisionPattern =
  /^manual-retry-(?<retryNumber>[1-9]\d*)-[0-9a-f-]+$/iu

const toReasonCodes = (value: unknown): Array<string> =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : []

export const isRetryableGeminiFailure = (
  result: ExtractionRetryResult,
): boolean => {
  const reasonCodes = toReasonCodes(result.reasonCodes)

  return (
    result.status === 'error' &&
    result.payload === null &&
    result.certificateCount === 0 &&
    reasonCodes.length > 0 &&
    reasonCodes.every((reasonCode) => retryableReasonCodes.has(reasonCode))
  )
}

export const getManualExtractionRetryNumber = (
  revisions: Array<string | null | undefined>,
): number => {
  let highestRetryNumber = 0

  for (const revision of revisions) {
    const match = revision?.match(manualRetryRevisionPattern)
    const retryNumber = Number(match?.groups?.retryNumber ?? 0)
    if (Number.isInteger(retryNumber) && retryNumber > highestRetryNumber) {
      highestRetryNumber = retryNumber
    }
  }

  return highestRetryNumber
}

export const buildExtractionRetryView = (input: {
  latestResult: ExtractionRetryResult
  extractionAttempts: Array<ExtractionRetryAttempt>
  file: ExtractionRetryFileState
  now?: Date
}): ExtractionRetryView | undefined => {
  if (!isRetryableGeminiFailure(input.latestResult)) {
    return undefined
  }

  const currentAttempt = input.extractionAttempts.find(
    (attempt) => attempt.id === input.latestResult.currentExtractionAttemptId,
  )
  if (!currentAttempt || currentAttempt.status !== 'failed') {
    return undefined
  }

  const retryCount = Math.max(
    getManualExtractionRetryNumber([input.file.revision]),
    ...input.extractionAttempts.map((attempt) => attempt.retryNumber),
  )
  const now = input.now ?? new Date()
  const cooldownEndsAt = new Date(
    (currentAttempt.finishedAt ?? currentAttempt.startedAt).getTime() +
      EXTRACTION_RETRY_COOLDOWN_MS,
  )
  const cooldownActive = cooldownEndsAt.getTime() > now.getTime()
  const alreadyProcessing =
    ['queued', 'processing'].includes(input.file.processingStatus) ||
    (input.file.processingStatus === 'pending' &&
      ['sending', 'queued', 'processing'].includes(input.file.queueStatus))

  const disabledReason: ExtractionRetryDisabledReason = alreadyProcessing
    ? 'already_processing'
    : retryCount >= MAX_MANUAL_EXTRACTION_RETRIES
      ? 'limit_reached'
      : cooldownActive
        ? 'cooldown'
        : null

  return {
    provider: 'gemini',
    sourceDocumentResultId: input.latestResult.id,
    sourceExtractionAttemptId: currentAttempt.id,
    reasonCodes: toReasonCodes(input.latestResult.reasonCodes),
    canRetry: disabledReason === null,
    retryCount,
    maxRetries: MAX_MANUAL_EXTRACTION_RETRIES,
    cooldownUntil: cooldownActive ? cooldownEndsAt.toISOString() : null,
    disabledReason,
  }
}

export const buildManualExtractionRetryRevision = (
  retryNumber: number,
  identifier: string,
) => `manual-retry-${retryNumber}-${identifier}`
