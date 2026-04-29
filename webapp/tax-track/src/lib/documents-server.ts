import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'

import type {
  DocumentErrorView,
  DocumentLogLevel,
  DocumentLogView,
  DocumentReviewFieldView,
  DocumentSigningStatus,
  DocumentTrailDetailView,
  DocumentTrailStatus,
  DocumentTrailStepView,
  DocumentValidationCheckView,
  OperationalDocumentView,
} from '@/lib/documents-types'
import { getDb } from '@/lib/db'
import {
  getSigningSummaries,
  getTemplateKeyForFile,
  getTemplatePlacementMap,
} from '@/lib/signing-server'
import {
  authUserTable,
  documentResults,
  intakeBatches,
  intakeFiles,
  reconciliationResults,
  workerJobSteps,
  workerJobs,
} from '@/lib/schema'
import { resolveOverallStatus } from '@/lib/intake-utils'

type DocumentResultRecord = typeof documentResults.$inferSelect
type IntakeBatchRecord = typeof intakeBatches.$inferSelect
type IntakeFileRecord = typeof intakeFiles.$inferSelect
type WorkerJobRecord = typeof workerJobs.$inferSelect
type WorkerJobStepRecord = typeof workerJobSteps.$inferSelect
type UserRecord = typeof authUserTable.$inferSelect
type ReconciliationRecord = typeof reconciliationResults.$inferSelect

type DocumentListKind = 'validated' | 'issues'

type JsonRecord = Record<string, unknown>

type SortableLogEntry = {
  at: Date | null
  timestamp: string
  level: DocumentLogLevel
  message: string
}

export type SigningSummary = {
  signingStatus: DocumentSigningStatus
  signedAt?: string
  signedByName?: string
  signedPdfUrl?: string
}

export type ReconciliationTrailSource = {
  matchStatus: string
  hasDifference: boolean
  createdAt?: Date | null
}

export type DocumentTrailContext = {
  reconciliation?: ReconciliationTrailSource
  signingSummary?: SigningSummary
  canSign?: boolean
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const STEP_LABELS: Record<string, string> = {
  load_input: 'Load input',
  extract_document: 'OCR / Layout',
  normalize_fields: 'AI Normalize',
  check_masterlist: 'Masterlist Check',
  validate_rules: 'Validation + Variance',
  dedupe_check: 'Deduplication',
  persist_validation_fail: 'Persist validation failure',
  persist_duplicate: 'Persist duplicate result',
  persist_validated: 'Rename + Persist',
  reconcile_document: 'Reconciliation',
  signing: 'Signing',
  finalize_workflow: 'Finalize workflow',
  workflow: 'Workflow',
}

const PIPELINE_STEPS: Array<{
  label: string
  description: string
  matches: (stepName: string) => boolean
}> = [
  {
    label: 'Uploaded',
    description: 'File received and stored.',
    matches: () => false,
  },
  {
    label: 'Queued',
    description: 'Document queued for processing.',
    matches: () => false,
  },
  {
    label: 'OCR / Layout',
    description: 'OCR and layout analysis completed.',
    matches: (stepName) =>
      stepName === 'load_input' || stepName === 'extract_document',
  },
  {
    label: 'AI Normalize',
    description: 'Data normalized using AI.',
    matches: (stepName) => stepName === 'normalize_fields',
  },
  {
    label: 'Masterlist Check',
    description: 'Checked against masterlist.',
    matches: (stepName) => stepName === 'check_masterlist',
  },
  {
    label: 'Validation + Variance',
    description: 'Validation and variance completed.',
    matches: (stepName) => stepName === 'validate_rules',
  },
  {
    label: 'Deduplication',
    description: 'Deduplication completed.',
    matches: (stepName) => stepName === 'dedupe_check',
  },
  {
    label: 'Rename + Persist',
    description: 'File renamed and persisted.',
    matches: (stepName) =>
      stepName === 'persist_validation_fail' ||
      stepName === 'persist_duplicate' ||
      stepName === 'persist_validated' ||
      stepName === 'finalize_workflow',
  },
  {
    label: 'Reconciliation',
    description: 'Reconciliation status from imported reconciliation results.',
    matches: () => false,
  },
  {
    label: 'Signing',
    description: 'Batch signing status.',
    matches: () => false,
  },
]

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toRecord = (value: unknown): JsonRecord => (isRecord(value) ? value : {})

const toStringValue = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''

const toNumberValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

const toStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : []

const toNumberArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === 'number' && Number.isFinite(item),
      )
    : []

const toFormattedDate = (value: Date | null | undefined) =>
  value ? DATE_FORMATTER.format(value) : '—'

const toOptionalFormattedDate = (value: Date | null | undefined) =>
  value ? DATE_FORMATTER.format(value) : undefined

const toSortableDate = (value: Date | null | undefined) => value ?? null

const toObjectFileName = (key: string | null | undefined) => {
  const trimmed = key?.trim()
  if (!trimmed) {
    return ''
  }

  return trimmed.split('/').pop()?.trim() || trimmed
}

const humanizeToken = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (token) => token.toUpperCase())

const classifyErrorType = (value: string) => {
  const normalized = value.toLowerCase()
  if (normalized.includes('masterlist')) return 'Masterlist'
  if (normalized.includes('tin')) return 'Missing TIN'
  if (normalized.includes('signature')) return 'Missing Signature'
  if (normalized.includes('printed name')) return 'Missing Printed Name'
  if (normalized.includes('variance')) return 'Variance'
  if (normalized.includes('duplicate')) return 'Duplicate'
  if (normalized.includes('atc')) return 'ATC'
  return 'Other'
}

const toSeverity = (status: string, reasons: Array<string>) => {
  if (status === 'Duplicate') {
    return 'Low'
  }

  const joined = reasons.join(' ').toLowerCase()
  if (
    joined.includes('missing') ||
    joined.includes('variance') ||
    joined.includes('invalid') ||
    joined.includes('failed')
  ) {
    return 'High'
  }

  return 'Medium'
}

const formatCurrency = (value: number | null) =>
  value === null ? '—' : NUMBER_FORMATTER.format(value)

const formatConfidence = (value: unknown) => {
  const confidenceMap = toRecord(value)
  const entries = Object.values(confidenceMap).flatMap((entry) => {
    const parsed = toNumberValue(entry)
    return parsed === null ? [] : [parsed]
  })

  if (entries.length === 0) {
    return '—'
  }

  const average =
    entries.reduce((acc, entry) => acc + entry, 0) / entries.length
  return average.toFixed(2)
}

const formatFieldConfidence = (value: unknown) => {
  const numeric = toNumberValue(value)
  return numeric === null ? '—' : numeric.toFixed(2)
}

const formatElapsed = (
  start: Date | null | undefined,
  end: Date | null | undefined,
) => {
  if (!start || !end) {
    return '—'
  }

  const diffMs = Math.max(0, end.getTime() - start.getTime())
  const totalSeconds = Math.round(diffMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes === 0) {
    return `${seconds}s`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours === 0) {
    return `${remainingMinutes}m ${seconds}s`
  }

  return `${hours}h ${remainingMinutes}m`
}

const parseDateToken = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const createDate = (year: number, monthIndex: number, day: number) => {
    const date = new Date(year, monthIndex, day)
    return Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== monthIndex ||
      date.getDate() !== day
      ? null
      : date
  }

  const compactUsMatch = trimmed.match(/^(\d{2})(\d{2})[/\s-](\d{4})$/)
  if (compactUsMatch) {
    const month = Number.parseInt(compactUsMatch[1], 10) - 1
    const day = Number.parseInt(compactUsMatch[2], 10)
    const year = Number.parseInt(compactUsMatch[3], 10)
    return createDate(year, month, day)
  }

  const usMatch = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/)
  if (usMatch) {
    const month = Number.parseInt(usMatch[1], 10) - 1
    const day = Number.parseInt(usMatch[2], 10)
    const year = Number.parseInt(usMatch[3], 10)
    return createDate(year, month, day)
  }

  const isoMatch = trimmed.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/)
  if (isoMatch) {
    const year = Number.parseInt(isoMatch[1], 10)
    const month = Number.parseInt(isoMatch[2], 10) - 1
    const day = Number.parseInt(isoMatch[3], 10)
    return createDate(year, month, day)
  }

  const isoCandidate = new Date(trimmed)
  return Number.isNaN(isoCandidate.getTime()) ? null : isoCandidate
}

const derivePeriodFromValue = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const quarterMatch = trimmed.match(/^Q([1-4])\s+(\d{4})$/i)
  if (quarterMatch) {
    const quarter = `Q${quarterMatch[1]}`
    const year = quarterMatch[2]
    const month =
      MONTHS[Number.parseInt(quarterMatch[1], 10) * 3 - 1] ?? 'Unknown'

    return {
      label: `${quarter} ${year}`,
      year,
      month,
      quarter,
    }
  }

  const rangeMatch =
    trimmed.match(/^(.+?)\s+to\s+(.+)$/i) ?? trimmed.match(/^(.+?)\s+-\s+(.+)$/)
  const parsedDate = rangeMatch
    ? (parseDateToken(rangeMatch[2]) ?? parseDateToken(rangeMatch[1]))
    : parseDateToken(trimmed)
  if (!parsedDate) {
    return null
  }

  const month = MONTHS[parsedDate.getMonth()] ?? 'Unknown'
  const year = String(parsedDate.getFullYear())
  const quarter = `Q${Math.floor(parsedDate.getMonth() / 3) + 1}`

  return {
    label: `${month} ${year}`,
    year,
    month,
    quarter,
  }
}

const derivePeriodFromFileName = (fileName: string) => {
  const compactMatch = fileName.match(/_(\d{2})(\d{2})(\d{4})_/)
  if (!compactMatch) {
    return {
      label: 'Unknown',
      year: 'Unknown',
      month: 'Unknown',
      quarter: 'Unknown',
    }
  }

  const monthIndex = Number.parseInt(compactMatch[1], 10) - 1
  const year = compactMatch[3]
  const hasKnownMonth = monthIndex >= 0 && monthIndex < MONTHS.length
  const month = hasKnownMonth ? MONTHS[monthIndex] : 'Unknown'
  const quarter =
    monthIndex >= 0 && monthIndex < 12
      ? `Q${Math.floor(monthIndex / 3) + 1}`
      : 'Unknown'

  return {
    label: hasKnownMonth ? `${month} ${year}` : year,
    year,
    month,
    quarter,
  }
}

const derivePeriod = (rawPeriod: string, fileName: string) =>
  derivePeriodFromValue(rawPeriod) ?? derivePeriodFromFileName(fileName)

const buildIssueReason = (
  validationRecord: JsonRecord,
  reasonCodes: Array<string>,
  errors: Array<DocumentErrorView>,
) => {
  const validationReasons = toStringArray(validationRecord.reasons)
    .map((reason) => humanizeToken(reason))
    .filter(Boolean)

  if (validationReasons.length > 0) {
    return Array.from(new Set(validationReasons)).join('; ')
  }

  const errorReasons = errors
    .map((error) => error.message.trim())
    .filter(Boolean)
  if (errorReasons.length > 0) {
    return Array.from(new Set(errorReasons)).join('; ')
  }

  const resultReasons = reasonCodes
    .map((reason) => humanizeToken(reason))
    .filter(Boolean)
  if (resultReasons.length > 0) {
    return Array.from(new Set(resultReasons)).join('; ')
  }

  return 'Requires review'
}

const parseBatchSummary = (payload: JsonRecord) => {
  const summary = toRecord(payload.batchSummary)
  const totalPages = toNumberValue(summary.totalPages) ?? 0

  if (totalPages <= 0) {
    return undefined
  }

  return {
    totalPages,
    certificatePageNumbers: toNumberArray(summary.certificatePageNumbers),
    ignoredPageNumbers: toNumberArray(summary.ignoredPageNumbers),
    validPageNumbers: toNumberArray(summary.validPageNumbers),
    failedPageNumbers: toNumberArray(summary.failedPageNumbers),
    duplicatePageNumbers: toNumberArray(summary.duplicatePageNumbers),
  }
}

const buildDocumentErrors = (
  resultStatus: string,
  validationRecord: JsonRecord,
  reasonCodes: Array<string>,
  steps: Array<WorkerJobStepRecord>,
) => {
  const checks = Array.isArray(validationRecord.checks)
    ? validationRecord.checks.filter(isRecord)
    : []

  const validationErrors = checks
    .filter((check) => check.passed === false)
    .map<DocumentErrorView>((check) => ({
      code: toStringValue(check.code) || 'VALIDATION',
      stage: 'Validation',
      message: toStringValue(check.message) || 'Validation check failed.',
    }))

  if (validationErrors.length > 0) {
    return validationErrors
  }

  if (resultStatus === 'Duplicate') {
    return [
      {
        code: 'DUPLICATE',
        stage: 'Deduplication',
        message:
          reasonCodes.length > 0
            ? humanizeToken(reasonCodes[0])
            : 'Document flagged as duplicate.',
      },
    ]
  }

  const failedStep = steps.find((step) => step.status === 'failed')
  const failedMetadata = toRecord(failedStep?.metadata)
  const failedMessage = toStringValue(failedMetadata.error)
  if (failedMessage) {
    return [
      {
        code: 'WORKFLOW',
        stage: humanizeToken(failedStep?.stepName ?? 'workflow'),
        message: failedMessage,
      },
    ]
  }

  return reasonCodes.map((reason) => ({
    code: humanizeToken(reason).toUpperCase().replace(/\s+/g, '_'),
    stage: 'Validation',
    message: humanizeToken(reason),
  }))
}

const buildValidationChecks = (
  validationRecord: JsonRecord,
): Array<DocumentValidationCheckView> => {
  const checks = Array.isArray(validationRecord.checks)
    ? validationRecord.checks.filter(isRecord)
    : []

  return checks.map((check) => ({
    code: toStringValue(check.code) || 'VALIDATION',
    passed: check.passed === true,
    message: toStringValue(check.message) || 'Validation check processed.',
  }))
}

const REVIEW_FIELD_DEFINITIONS = [
  ['periodCovered', 'Period covered'],
  ['periodEnd', 'Period end'],
  ['payeeName', 'Payee name'],
  ['payeeTin', 'Payee TIN'],
  ['payorName', 'Payor name'],
  ['payorTin', 'Payor TIN'],
  ['atcCode', 'ATC code'],
  ['taxBase', 'Tax base'],
  ['taxWithheld', 'Tax withheld'],
  ['printedName', 'Printed name'],
  ['signatoryTitle', 'Signatory title'],
  ['signatoryTin', 'Signatory TIN'],
  ['signaturePresent', 'Signature present'],
  ['signatureText', 'Signature text'],
  ['companyName', 'Company name'],
] as const

const buildReviewFields = (
  normalized: JsonRecord,
): Array<DocumentReviewFieldView> => {
  const confidenceMap = toRecord(normalized.confidenceMap)

  return REVIEW_FIELD_DEFINITIONS.map(([key, label]) => {
    const rawValue = normalized[key]
    const numeric = toNumberValue(rawValue)
    const value =
      typeof rawValue === 'boolean'
        ? rawValue
          ? 'Yes'
          : 'No'
        : numeric !== null
          ? NUMBER_FORMATTER.format(numeric)
          : toStringValue(rawValue) || '—'

    return {
      label,
      value,
      confidence: formatFieldConfidence(confidenceMap[key]),
    }
  })
}

const buildDocumentLogs = (
  fileRecord: IntakeFileRecord,
  steps: Array<WorkerJobStepRecord>,
) => {
  const logs: Array<SortableLogEntry> = []

  if (fileRecord.uploadedAt) {
    logs.push({
      at: fileRecord.uploadedAt,
      timestamp: toFormattedDate(fileRecord.uploadedAt),
      level: 'info',
      message: 'File uploaded to the source bucket.',
    })
  }

  if (fileRecord.queuedAt) {
    logs.push({
      at: fileRecord.queuedAt,
      timestamp: toFormattedDate(fileRecord.queuedAt),
      level: 'info',
      message: 'Document queued for async processing.',
    })
  }

  for (const step of steps) {
    const metadata = toRecord(step.metadata)
    const reasonCodes = toStringArray(metadata.reasonCodes)
    const errorMessage = toStringValue(metadata.error)
    const stepLabel = STEP_LABELS[step.stepName] ?? humanizeToken(step.stepName)
    const level: DocumentLogLevel =
      step.status === 'failed' || step.status === 'error'
        ? 'error'
        : step.status === 'duplicate'
          ? 'warning'
          : 'info'

    const message = errorMessage
      ? `${stepLabel} failed: ${errorMessage}`
      : reasonCodes.length > 0
        ? `${stepLabel} completed with ${reasonCodes.map(humanizeToken).join(', ')}.`
        : `${stepLabel} ${step.status === 'success' ? 'completed' : humanizeToken(step.status).toLowerCase()}.`

    logs.push({
      at: toSortableDate(step.createdAt),
      timestamp: toFormattedDate(step.createdAt),
      level,
      message,
    })
  }

  return logs
    .sort((left, right) => {
      const leftTime = left.at?.getTime() ?? 0
      const rightTime = right.at?.getTime() ?? 0
      return leftTime - rightTime
    })
    .map<DocumentLogView>(({ timestamp, level, message }) => ({
      timestamp,
      level,
      message,
    }))
}

const buildLifecycleTrailStep = (
  label: 'Reconciliation' | 'Signing',
  status: DocumentTrailStatus,
  detail?: string,
): DocumentTrailStepView => ({
  label,
  status,
  ...(detail ? { detail } : {}),
})

export const buildReconciliationTrailStep = (
  resultStatus: string,
  reconciliation?: ReconciliationTrailSource,
): DocumentTrailStepView => {
  if (resultStatus !== 'Ready') {
    return buildLifecycleTrailStep('Reconciliation', 'pending')
  }

  if (!reconciliation) {
    return buildLifecycleTrailStep(
      'Reconciliation',
      'active',
      'Ready for reconciliation.',
    )
  }

  if (reconciliation.matchStatus === 'matched') {
    return buildLifecycleTrailStep(
      'Reconciliation',
      'complete',
      reconciliation.hasDifference
        ? 'Reconciliation completed with variance.'
        : 'Reconciliation matched.',
    )
  }

  return buildLifecycleTrailStep(
    'Reconciliation',
    'error',
    'Reconciliation did not match this certificate.',
  )
}

export const buildSigningTrailStep = (
  resultStatus: string,
  context: DocumentTrailContext,
): DocumentTrailStepView => {
  if (context.signingSummary?.signingStatus === 'failed') {
    return buildLifecycleTrailStep('Signing', 'error', 'Signing failed.')
  }

  if (context.signingSummary?.signingStatus === 'signed') {
    return buildLifecycleTrailStep(
      'Signing',
      'complete',
      context.signingSummary.signedByName
        ? `Signed by ${context.signingSummary.signedByName}.`
        : undefined,
    )
  }

  if (resultStatus === 'Ready' && context.canSign) {
    return buildLifecycleTrailStep(
      'Signing',
      'active',
      'Ready for batch signing.',
    )
  }

  return buildLifecycleTrailStep('Signing', 'pending')
}

const buildDocumentTrail = (
  fileRecord: IntakeFileRecord,
  jobRecord: WorkerJobRecord | null,
  resultStatus: string,
  issueReason: string,
  steps: Array<WorkerJobStepRecord>,
  context: DocumentTrailContext = {},
): Array<DocumentTrailStepView> => {
  const trail = PIPELINE_STEPS.map<DocumentTrailStepView>((step) => ({
    label: step.label,
    status: 'pending',
  }))

  trail[0] = {
    label: 'Uploaded',
    status:
      fileRecord.uploadStatus === 'uploaded' ||
      fileRecord.queueStatus !== 'pending' ||
      fileRecord.processingStatus !== 'pending'
        ? 'complete'
        : 'pending',
  }

  trail[1] = {
    label: 'Queued',
    status:
      fileRecord.processingStatus === 'processing' ||
      ['success', 'duplicate', 'error'].includes(fileRecord.processingStatus)
        ? 'complete'
        : fileRecord.queueStatus === 'queued' ||
            fileRecord.queueStatus === 'sending'
          ? 'active'
          : fileRecord.queueStatus === 'failed'
            ? 'error'
            : 'pending',
    detail:
      fileRecord.queueStatus === 'failed'
        ? (fileRecord.errorMessage ?? 'Queue submission failed.')
        : undefined,
  }

  for (const [index, pipelineStep] of PIPELINE_STEPS.entries()) {
    if (index < 2) {
      continue
    }

    const matchingSteps = steps.filter((step) =>
      pipelineStep.matches(step.stepName),
    )
    const statuses = new Set(matchingSteps.map((step) => step.status))

    if (statuses.has('failed') || statuses.has('error')) {
      trail[index] = {
        label: pipelineStep.label,
        status: 'error',
        detail: matchingSteps
          .map((step) => toStringValue(toRecord(step.metadata).error))
          .find(Boolean),
      }
      continue
    }

    if (statuses.has('duplicate')) {
      trail[index] = {
        label: pipelineStep.label,
        status: 'error',
        detail: issueReason,
      }
      continue
    }

    if (matchingSteps.length > 0 && statuses.has('success')) {
      trail[index] = {
        label: pipelineStep.label,
        status: 'complete',
      }
      continue
    }

    if (
      jobRecord?.currentStep &&
      pipelineStep.matches(jobRecord.currentStep) &&
      !['success', 'duplicate', 'error', 'failed'].includes(jobRecord.status)
    ) {
      trail[index] = {
        label: pipelineStep.label,
        status: 'active',
        detail: humanizeToken(jobRecord.currentStep),
      }
    }
  }

  return trail.map((step) =>
    step.label === 'Reconciliation'
      ? buildReconciliationTrailStep(resultStatus, context.reconciliation)
      : step.label === 'Signing'
        ? buildSigningTrailStep(resultStatus, context)
        : step,
  )
}

const buildLifecycleTrailDetail = (
  pipelineStep: (typeof PIPELINE_STEPS)[number],
  step: DocumentTrailStepView,
  context: DocumentTrailContext,
): DocumentTrailDetailView | null => {
  if (pipelineStep.label === 'Reconciliation') {
    return {
      label: pipelineStep.label,
      timestamp: toFormattedDate(context.reconciliation?.createdAt),
      description:
        step.detail ||
        (step.status === 'complete'
          ? 'Reconciliation completed.'
          : step.status === 'active'
            ? 'Ready for reconciliation.'
            : step.status === 'error'
              ? 'Reconciliation needs review.'
              : 'Waiting for reconciliation.'),
      status: step.status,
    }
  }

  if (pipelineStep.label === 'Signing') {
    return {
      label: pipelineStep.label,
      timestamp: context.signingSummary?.signedAt ?? '—',
      description:
        step.detail ||
        (step.status === 'complete'
          ? 'Certificate signed.'
          : step.status === 'active'
            ? 'Ready for batch signing.'
            : step.status === 'error'
              ? 'Signing failed.'
              : 'Waiting for batch signing.'),
      status: step.status,
    }
  }

  return null
}

const buildDocumentTrailDetails = (
  fileRecord: IntakeFileRecord,
  jobRecord: WorkerJobRecord | null,
  trail: Array<DocumentTrailStepView>,
  issueReason: string,
  steps: Array<WorkerJobStepRecord>,
  context: DocumentTrailContext = {},
): Array<DocumentTrailDetailView> =>
  PIPELINE_STEPS.map((pipelineStep, index) => {
    const step = trail[index]
    const lifecycleDetail = buildLifecycleTrailDetail(
      pipelineStep,
      step,
      context,
    )

    if (lifecycleDetail) {
      return lifecycleDetail
    }

    const matchingSteps = steps.filter((entry) =>
      pipelineStep.matches(entry.stepName),
    )
    const latestMatchingStep = matchingSteps.at(-1) ?? null
    const latestMetadata = latestMatchingStep
      ? toRecord(latestMatchingStep.metadata)
      : {}

    let timestamp = '—'
    let description = step.detail || pipelineStep.description

    if (pipelineStep.label === 'Uploaded') {
      timestamp = toFormattedDate(fileRecord.uploadedAt ?? fileRecord.createdAt)
    } else if (pipelineStep.label === 'Queued') {
      timestamp = toFormattedDate(fileRecord.queuedAt)
      if (fileRecord.queueStatus === 'failed') {
        description = fileRecord.errorMessage || 'Queue submission failed.'
      }
    } else {
      timestamp = toFormattedDate(
        latestMatchingStep ? latestMatchingStep.createdAt : null,
      )

      if (step.status === 'error') {
        description =
          step.detail ||
          toStringValue(latestMetadata.error) ||
          issueReason ||
          `${pipelineStep.label} failed.`
      } else if (step.status === 'active') {
        description =
          step.detail ||
          (latestMatchingStep
            ? `${STEP_LABELS[latestMatchingStep.stepName] ?? humanizeToken(latestMatchingStep.stepName)} in progress.`
            : `${pipelineStep.label} in progress.`)
      } else if (step.status === 'pending') {
        description = `Waiting for ${pipelineStep.label.toLowerCase()}.`
      }

      if (
        pipelineStep.label === 'Reconciliation' &&
        timestamp === '—' &&
        step.status === 'complete'
      ) {
        timestamp = toFormattedDate(
          jobRecord?.finishedAt ??
            fileRecord.processingFinishedAt ??
            jobRecord?.updatedAt,
        )
      }
    }

    return {
      label: pipelineStep.label,
      timestamp,
      description,
      status: step.status,
    }
  })

const deriveLiveStatus = (
  fileRecord: IntakeFileRecord,
  jobRecord: WorkerJobRecord | null,
) => {
  if (fileRecord.errorMessage || fileRecord.queueStatus === 'failed') {
    return 'Error'
  }

  if (
    fileRecord.processingStatus === 'processing' ||
    jobRecord?.status === 'processing'
  ) {
    return 'Processing'
  }

  if (
    fileRecord.processingStatus === 'success' ||
    fileRecord.processingStatus === 'duplicate' ||
    fileRecord.processingStatus === 'error'
  ) {
    return fileRecord.processingStatus === 'duplicate'
      ? 'Duplicate'
      : fileRecord.processingStatus === 'success'
        ? 'Ready'
        : 'Error'
  }

  if (
    fileRecord.queueStatus === 'queued' ||
    fileRecord.queueStatus === 'sending' ||
    jobRecord?.status === 'queued'
  ) {
    return 'Queued'
  }

  if (fileRecord.uploadStatus === 'uploaded') {
    return 'Uploaded'
  }

  return 'Pending'
}

const deriveLiveStage = (
  status: string,
  fileRecord: IntakeFileRecord,
  jobRecord: WorkerJobRecord | null,
) => {
  const currentStep =
    toStringValue(jobRecord?.currentStep) ||
    toStringValue(fileRecord.currentStep)
  const currentPhase =
    toStringValue(jobRecord?.currentPhase) ||
    toStringValue(fileRecord.currentPhase)

  if (status === 'Processing') {
    if (currentStep) {
      return humanizeToken(currentStep)
    }

    if (currentPhase) {
      return humanizeToken(currentPhase)
    }

    return 'Async worker running'
  }

  if (status === 'Queued') {
    return 'Queued for processing'
  }

  if (status === 'Uploaded') {
    return 'Uploaded to source bucket'
  }

  if (status === 'Error') {
    return 'Upload or queue failed'
  }

  return 'Pending upload'
}

const deriveLiveNextStep = (
  status: string,
  fileRecord: IntakeFileRecord,
  jobRecord: WorkerJobRecord | null,
) => {
  const currentStep =
    toStringValue(jobRecord?.currentStep) ||
    toStringValue(fileRecord.currentStep)

  if (status === 'Processing') {
    return currentStep
      ? humanizeToken(currentStep)
      : 'Continue worker processing'
  }

  if (status === 'Queued') {
    return 'Await worker pickup'
  }

  if (status === 'Uploaded') {
    return 'Queue submission'
  }

  if (status === 'Error') {
    return 'Review upload error'
  }

  return 'Start upload'
}

const buildLiveDocumentErrors = (
  status: string,
  fileRecord: IntakeFileRecord,
  jobRecord: WorkerJobRecord | null,
  steps: Array<WorkerJobStepRecord>,
) => {
  if (status !== 'Error') {
    return [] satisfies Array<DocumentErrorView>
  }

  const failedStep = steps.find((step) => step.status === 'failed')
  const failedMetadata = toRecord(failedStep?.metadata)
  const failedMessage = toStringValue(failedMetadata.error)
  if (failedMessage) {
    return [
      {
        code: 'WORKFLOW',
        stage: humanizeToken(failedStep?.stepName ?? 'workflow'),
        message: failedMessage,
      },
    ]
  }

  if (fileRecord.queueStatus === 'failed') {
    return [
      {
        code: 'QUEUE',
        stage: 'Queue submission',
        message: fileRecord.errorMessage ?? 'Queue submission failed.',
      },
    ]
  }

  return [
    {
      code: 'UPLOAD',
      stage: humanizeToken(
        jobRecord?.currentStep ?? fileRecord.currentStep ?? 'upload',
      ),
      message:
        fileRecord.errorMessage ||
        jobRecord?.errorSummary ||
        'Upload processing failed before a terminal result was recorded.',
    },
  ]
}

const toLatestByKey = <TItem, TKey extends string | number>(
  items: Array<TItem>,
  getKey: (item: TItem) => TKey,
) => {
  const map = new Map<TKey, TItem>()
  for (const item of items) {
    const key = getKey(item)
    if (!map.has(key)) {
      map.set(key, item)
    }
  }

  return map
}

const blocksBatchSigning = (file: IntakeFileRecord) =>
  ['pending', 'uploaded', 'queued', 'processing'].includes(
    resolveOverallStatus(file),
  )

const buildBatchSigningReadiness = (
  batches: Array<IntakeBatchRecord>,
  files: Array<IntakeFileRecord>,
) => {
  const filesByBatchId = new Map<string, Array<IntakeFileRecord>>()
  for (const file of files) {
    const current = filesByBatchId.get(file.batchId) ?? []
    current.push(file)
    filesByBatchId.set(file.batchId, current)
  }

  return new Map(
    batches.map((batch) => {
      const batchFiles = filesByBatchId.get(batch.id) ?? []

      return [
        batch.id,
        batch.status === 'closed' &&
          batchFiles.length > 0 &&
          !batchFiles.some((file) => blocksBatchSigning(file)),
      ] as const
    }),
  )
}

const buildDocumentViews = async (results: Array<DocumentResultRecord>) => {
  if (results.length === 0) {
    return [] satisfies Array<OperationalDocumentView>
  }

  const db = getDb()
  const uploadIds = results.map((result) => result.uploadId)
  const files = await db
    .select()
    .from(intakeFiles)
    .where(inArray(intakeFiles.id, uploadIds))

  const relatedResults = await db
    .select()
    .from(documentResults)
    .where(inArray(documentResults.uploadId, uploadIds))
    .orderBy(desc(documentResults.createdAt))

  const fileById = new Map(files.map((file) => [file.id, file]))
  const batchIds = Array.from(new Set(files.map((file) => file.batchId)))
  const batches =
    batchIds.length === 0
      ? []
      : await db
          .select()
          .from(intakeBatches)
          .where(inArray(intakeBatches.id, batchIds))
  const batchFiles =
    batchIds.length === 0
      ? []
      : await db
          .select()
          .from(intakeFiles)
          .where(
            and(
              inArray(intakeFiles.batchId, batchIds),
              isNull(intakeFiles.removedFromBatchAt),
            ),
          )
  const batchSigningReadyByBatchId = buildBatchSigningReadiness(
    batches,
    batchFiles,
  )
  const relatedResultsByUploadId = new Map<
    string,
    Array<DocumentResultRecord>
  >()
  for (const result of relatedResults) {
    const current = relatedResultsByUploadId.get(result.uploadId) ?? []
    current.push(result)
    relatedResultsByUploadId.set(result.uploadId, current)
  }

  const jobs = await db
    .select()
    .from(workerJobs)
    .where(inArray(workerJobs.uploadId, uploadIds))
    .orderBy(desc(workerJobs.createdAt))

  const latestJobByUploadId = toLatestByKey(jobs, (job) => job.uploadId)
  const latestJobs = Array.from(latestJobByUploadId.values())
  const jobIds = latestJobs.map((job) => job.jobId)

  const steps =
    jobIds.length === 0
      ? []
      : await db
          .select()
          .from(workerJobSteps)
          .where(inArray(workerJobSteps.jobId, jobIds))
          .orderBy(asc(workerJobSteps.createdAt))

  const stepsByJobId = new Map<string, Array<WorkerJobStepRecord>>()
  for (const step of steps) {
    const current = stepsByJobId.get(step.jobId) ?? []
    current.push(step)
    stepsByJobId.set(step.jobId, current)
  }

  const uploaderIds = Array.from(
    new Set(files.map((file) => file.uploadedByUserId)),
  )
  const uploaders =
    uploaderIds.length === 0
      ? []
      : await db
          .select()
          .from(authUserTable)
          .where(inArray(authUserTable.id, uploaderIds))

  const uploaderById = new Map<string, UserRecord>(
    uploaders.map((user) => [user.id, user]),
  )
  const successfulCertificateResults = results.filter(
    (result) =>
      result.documentKind === 'certificate' && result.status === 'success',
  )
  const signingSummaries = await getSigningSummaries(
    successfulCertificateResults.map((result) => result.id),
  )
  const certificateResultIds = successfulCertificateResults.map(
    (result) => result.id,
  )
  const reconciliationRows =
    certificateResultIds.length === 0
      ? []
      : await db
          .select()
          .from(reconciliationResults)
          .where(
            inArray(
              reconciliationResults.matchedTaxRecordId,
              certificateResultIds,
            ),
          )
          .orderBy(
            desc(reconciliationResults.createdAt),
            desc(reconciliationResults.id),
          )
  const reconciliationByResultId = toLatestByKey(
    reconciliationRows.filter(
      (
        row,
      ): row is ReconciliationRecord & {
        matchedTaxRecordId: number
      } => row.matchedTaxRecordId !== null,
    ),
    (row) => row.matchedTaxRecordId,
  )
  const templatePlacementMap = await getTemplatePlacementMap(files)

  return results.flatMap<OperationalDocumentView>((result) => {
    const fileRecord = fileById.get(result.uploadId)
    if (!fileRecord) {
      return []
    }

    const jobRecord = latestJobByUploadId.get(result.uploadId) ?? null
    const jobSteps = jobRecord ? (stepsByJobId.get(jobRecord.jobId) ?? []) : []
    const payload = toRecord(result.payload)
    const normalized = toRecord(payload.normalized)
    const validationRecord = toRecord(result.validation)
    const batchSummary = parseBatchSummary(payload)
    const reasonCodes = toStringArray(result.reasonCodes)
    const payee =
      toStringValue(normalized.payeeName) ||
      toStringValue(normalized.companyName) ||
      'Unknown payee'
    const rawPeriod =
      toStringValue(normalized.periodCovered) ||
      toStringValue(normalized.periodEnd)

    const period = derivePeriod(rawPeriod, fileRecord.originalFileName)
    const atc =
      toStringValue(normalized.atcCode) ||
      toStringValue(validationRecord.atcCode) ||
      '—'
    const taxBase = formatCurrency(
      toNumberValue(normalized.taxBase) ??
        toNumberValue(validationRecord.reportedTaxBase),
    )
    const taxWithheld = formatCurrency(toNumberValue(normalized.taxWithheld))
    const confidence = formatConfidence(normalized.confidenceMap)
    const errors = buildDocumentErrors(
      result.status,
      validationRecord,
      reasonCodes,
      jobSteps,
    )
    const validationChecks = buildValidationChecks(validationRecord)
    const reviewFields = buildReviewFields(normalized)
    const issueReason = buildIssueReason(validationRecord, reasonCodes, errors)
    const errorTypes =
      errors.length > 0
        ? Array.from(
            new Set(errors.map((error) => classifyErrorType(error.message))),
          )
        : ['None']
    const status =
      result.status === 'success'
        ? 'Ready'
        : result.status === 'duplicate'
          ? 'Duplicate'
          : 'Error'
    const ownerRecord = uploaderById.get(fileRecord.uploadedByUserId)
    const owner = ownerRecord?.name || ownerRecord?.email || 'Unknown uploader'
    const signingSummary =
      result.documentKind === 'certificate'
        ? signingSummaries.get(result.id)
        : undefined
    const reconciliation =
      result.documentKind === 'certificate' && result.status === 'success'
        ? reconciliationByResultId.get(result.id)
        : undefined
    const canSign =
      result.documentKind === 'certificate' &&
      status === 'Ready' &&
      batchSigningReadyByBatchId.get(fileRecord.batchId) === true &&
      signingSummary?.signingStatus !== 'signed'
    const trailContext: DocumentTrailContext = {
      reconciliation,
      signingSummary,
      canSign,
    }
    const updatedAtValue = jobRecord?.updatedAt ?? fileRecord.updatedAt
    const processingUpdatedAt = jobRecord?.updatedAt ?? result.createdAt
    const processingStartedAt =
      jobRecord?.startedAt ?? fileRecord.processingStartedAt
    const processingFinishedAt =
      jobRecord?.finishedAt ?? fileRecord.processingFinishedAt
    const stage =
      status === 'Ready'
        ? 'Validated'
        : status === 'Duplicate'
          ? 'Needs review'
          : 'Validation failed'
    const nextStep =
      status === 'Ready' ? 'Review or export' : 'Review in Issues Queue'
    const trail = buildDocumentTrail(
      fileRecord,
      jobRecord,
      status,
      issueReason,
      jobSteps,
      trailContext,
    )
    const trailDetails = buildDocumentTrailDetails(
      fileRecord,
      jobRecord,
      trail,
      issueReason,
      jobSteps,
      trailContext,
    )
    const logs = buildDocumentLogs(fileRecord, jobSteps)
    const relatedDocuments = (
      relatedResultsByUploadId.get(result.uploadId) ?? []
    )
      .filter((related) => related.documentKind === 'certificate')
      .map((related) => ({
        id: String(related.id),
        label:
          related.pageNumber === null
            ? 'Certificate result'
            : `Certificate page ${related.pageNumber}`,
        status:
          related.status === 'success'
            ? 'Ready'
            : related.status === 'duplicate'
              ? 'Duplicate'
              : 'Error',
        pageNumber: related.pageNumber,
      }))
      .sort((left, right) => (left.pageNumber ?? 0) - (right.pageNumber ?? 0))

    return [
      {
        id:
          result.documentKind === 'certificate'
            ? String(result.id)
            : fileRecord.id,
        kind: result.documentKind === 'certificate' ? 'certificate' : 'upload',
        uploadId: fileRecord.id,
        uploadBatchId: fileRecord.batchId,
        attentionStatus:
          fileRecord.attentionStatus === 'resolved' ? 'resolved' : 'open',
        attentionResolvedAt: toFormattedDate(fileRecord.attentionResolvedAt),
        removedFromBatchAt: toOptionalFormattedDate(
          fileRecord.removedFromBatchAt,
        ),
        pageNumber: result.pageNumber,
        fileName:
          result.documentKind === 'certificate'
            ? toObjectFileName(result.finalKey) ||
              `${fileRecord.originalFileName} (Page ${result.pageNumber ?? 1})`
            : fileRecord.originalFileName,
        uploadedAt: toFormattedDate(fileRecord.uploadedAt),
        sizeBytes: fileRecord.sizeBytes,
        status,
        stage,
        nextStep,
        payee,
        period: period.label,
        atc,
        taxBase,
        taxWithheld,
        confidence,
        year: period.year,
        month: period.month,
        quarter: period.quarter,
        entity: 'Manual Upload',
        customerType: 'BIR 2307',
        errorTypes,
        issueReason,
        severity: toSeverity(status, [issueReason, ...reasonCodes]),
        owner,
        updatedAt: toFormattedDate(updatedAtValue),
        processing: {
          startedAt: toFormattedDate(processingStartedAt),
          updatedAt: toFormattedDate(processingUpdatedAt),
          worker: jobRecord?.jobId ?? 'async-worker',
          elapsed: formatElapsed(
            processingStartedAt,
            processingFinishedAt ?? processingUpdatedAt,
          ),
        },
        trail,
        trailDetails,
        logs,
        errors,
        validationChecks,
        reviewFields,
        batchSummary,
        relatedDocuments,
        canSign,
        signingStatus: signingSummary?.signingStatus ?? 'unsigned',
        signedAt: signingSummary?.signedAt,
        signedByName: signingSummary?.signedByName,
        signedPdfUrl: signingSummary?.signedPdfUrl,
        hasSavedTemplatePlacement:
          templatePlacementMap.get(getTemplateKeyForFile(fileRecord)) ?? false,
      },
    ]
  })
}

export const listOperationalDocuments = async (
  kind: DocumentListKind,
  limit = 200,
) => {
  const db = getDb()
  const results = await db
    .select()
    .from(documentResults)
    .orderBy(desc(documentResults.createdAt))
    .limit(Math.max(limit * 8, 200))

  const filteredResults = results.filter((result) =>
    kind === 'validated'
      ? result.documentKind === 'certificate' && result.status === 'success'
      : result.documentKind === 'upload' && result.status !== 'success',
  )

  return buildDocumentViews(filteredResults.slice(0, limit))
}

export const getOperationalDocument = async (documentId: string) => {
  const db = getDb()
  const resultId = /^\d+$/u.test(documentId)
    ? Number.parseInt(documentId, 10)
    : null

  if (resultId !== null) {
    const resultRows = await db
      .select()
      .from(documentResults)
      .where(eq(documentResults.id, resultId))
      .limit(1)
    const result = resultRows.at(0)

    if (result !== undefined) {
      const [document] = await buildDocumentViews([result])
      return document
    }
  }

  const results = await db
    .select()
    .from(documentResults)
    .where(eq(documentResults.uploadId, documentId))
    .orderBy(desc(documentResults.createdAt))

  if (results.length === 0) {
    const fileRows = await db
      .select()
      .from(intakeFiles)
      .where(eq(intakeFiles.id, documentId))
      .limit(1)
    const fileRecord = fileRows.at(0)

    if (fileRecord === undefined) {
      return null
    }

    const jobRows = await db
      .select()
      .from(workerJobs)
      .where(eq(workerJobs.uploadId, documentId))
      .orderBy(desc(workerJobs.createdAt))
      .limit(1)
    const jobRecord = jobRows.at(0) ?? null

    const steps = jobRecord
      ? await db
          .select()
          .from(workerJobSteps)
          .where(eq(workerJobSteps.jobId, jobRecord.jobId))
          .orderBy(asc(workerJobSteps.createdAt))
      : []

    const ownerRows = await db
      .select()
      .from(authUserTable)
      .where(eq(authUserTable.id, fileRecord.uploadedByUserId))
      .limit(1)
    const ownerRecord = ownerRows.at(0) ?? null

    const status = deriveLiveStatus(fileRecord, jobRecord)
    const stage = deriveLiveStage(status, fileRecord, jobRecord)
    const nextStep = deriveLiveNextStep(status, fileRecord, jobRecord)
    const period = derivePeriod('', fileRecord.originalFileName)
    const issueReason =
      fileRecord.errorMessage ||
      jobRecord?.errorSummary ||
      (status === 'Processing'
        ? 'Document is still processing.'
        : status === 'Queued'
          ? 'Document is waiting for worker pickup.'
          : status === 'Uploaded'
            ? 'Document was uploaded and is waiting to be queued.'
            : 'Document intake is pending.')
    const errors = buildLiveDocumentErrors(status, fileRecord, jobRecord, steps)
    const trail = buildDocumentTrail(
      fileRecord,
      jobRecord,
      status,
      issueReason,
      steps,
    )

    return {
      id: fileRecord.id,
      kind: 'upload',
      uploadId: fileRecord.id,
      uploadBatchId: fileRecord.batchId,
      attentionStatus:
        fileRecord.attentionStatus === 'resolved' ? 'resolved' : 'open',
      attentionResolvedAt: toFormattedDate(fileRecord.attentionResolvedAt),
      removedFromBatchAt: toOptionalFormattedDate(
        fileRecord.removedFromBatchAt,
      ),
      pageNumber: null,
      fileName: fileRecord.originalFileName,
      uploadedAt: toFormattedDate(fileRecord.uploadedAt),
      sizeBytes: fileRecord.sizeBytes,
      status,
      stage,
      nextStep,
      payee: 'Unknown payee',
      period: period.label,
      atc: '—',
      taxBase: '—',
      taxWithheld: '—',
      confidence: '—',
      year: period.year,
      month: period.month,
      quarter: period.quarter,
      entity: 'Manual Upload',
      customerType: 'BIR 2307',
      errorTypes:
        errors.length > 0
          ? Array.from(
              new Set(errors.map((error) => classifyErrorType(error.message))),
            )
          : ['None'],
      issueReason,
      severity: status === 'Error' ? 'High' : 'Low',
      owner: ownerRecord?.name || ownerRecord?.email || 'Unknown uploader',
      updatedAt: toFormattedDate(jobRecord?.updatedAt ?? fileRecord.updatedAt),
      processing: {
        startedAt: toFormattedDate(
          jobRecord?.startedAt ?? fileRecord.processingStartedAt,
        ),
        updatedAt: toFormattedDate(
          jobRecord?.updatedAt ?? fileRecord.updatedAt,
        ),
        worker: jobRecord?.jobId ?? 'async-worker',
        elapsed: formatElapsed(
          jobRecord?.startedAt ?? fileRecord.processingStartedAt,
          jobRecord?.finishedAt ??
            fileRecord.processingFinishedAt ??
            jobRecord?.updatedAt ??
            fileRecord.updatedAt,
        ),
      },
      trail,
      trailDetails: buildDocumentTrailDetails(
        fileRecord,
        jobRecord,
        trail,
        issueReason,
        steps,
      ),
      logs: buildDocumentLogs(fileRecord, steps),
      errors,
      validationChecks: [],
      reviewFields: [],
      batchSummary: undefined,
      relatedDocuments: [],
      canSign: false,
      signingStatus: 'unsigned',
      signedAt: undefined,
      signedByName: undefined,
      signedPdfUrl: undefined,
      hasSavedTemplatePlacement: false,
    }
  }

  const documents = await buildDocumentViews(results)
  const uploadDocument = documents.find(
    (document) => document.kind === 'upload',
  )
  if (uploadDocument) {
    return {
      ...uploadDocument,
      id: documentId,
      kind: 'upload',
      uploadId: documentId,
      pageNumber: null,
    }
  }

  const certificateDocuments = documents.filter(
    (document) => document.kind === 'certificate',
  )
  if (certificateDocuments.length === 0) {
    return null
  }

  const primary = certificateDocuments[0]
  const signableCertificateDocuments = certificateDocuments.filter(
    (document) => document.canSign,
  )
  const signedCertificateDocuments = certificateDocuments.filter(
    (document) => document.signingStatus === 'signed',
  )
  const failedSigningDocuments = certificateDocuments.filter(
    (document) => document.signingStatus === 'failed',
  )
  const latestSignedDocument = signedCertificateDocuments
    .slice()
    .sort((left, right) => {
      const leftValue = left.signedAt ?? ''
      const rightValue = right.signedAt ?? ''

      return rightValue.localeCompare(leftValue)
    })
    .at(0)
  const allCertificateDocumentsSigned =
    certificateDocuments.length > 0 &&
    signedCertificateDocuments.length === certificateDocuments.length
  const nextStep = signableCertificateDocuments.length
    ? 'Sign batch'
    : allCertificateDocumentsSigned
      ? 'View signed batch'
      : 'Review generated certificates'

  return {
    ...primary,
    id: documentId,
    kind: 'upload',
    uploadId: documentId,
    uploadBatchId: primary.uploadBatchId,
    attentionStatus: primary.attentionStatus,
    attentionResolvedAt: primary.attentionResolvedAt,
    removedFromBatchAt: primary.removedFromBatchAt,
    pageNumber: null,
    stage: 'Validated batch',
    nextStep,
    payee:
      certificateDocuments.length === 1
        ? primary.payee
        : `${certificateDocuments.length} certificate pages`,
    period:
      certificateDocuments.length === 1
        ? primary.period
        : 'Multiple certificates',
    atc: certificateDocuments.length === 1 ? primary.atc : 'Multiple',
    taxBase: certificateDocuments.length === 1 ? primary.taxBase : '—',
    taxWithheld: certificateDocuments.length === 1 ? primary.taxWithheld : '—',
    confidence: certificateDocuments.length === 1 ? primary.confidence : '—',
    issueReason: `Processed ${certificateDocuments.length} certificate pages.`,
    severity: 'Low',
    errors: [],
    batchSummary: primary.batchSummary,
    relatedDocuments: certificateDocuments.map((document) => ({
      id: document.id,
      label:
        document.pageNumber === null
          ? 'Certificate result'
          : `Certificate page ${document.pageNumber}`,
      status: document.status,
      pageNumber: document.pageNumber,
    })),
    canSign: signableCertificateDocuments.length > 0,
    signingStatus: allCertificateDocumentsSigned
      ? 'signed'
      : failedSigningDocuments.length > 0
        ? 'failed'
        : 'unsigned',
    signedAt: latestSignedDocument?.signedAt,
    signedByName: latestSignedDocument?.signedByName,
    signedPdfUrl: undefined,
    hasSavedTemplatePlacement: certificateDocuments.some(
      (document) => document.hasSavedTemplatePlacement,
    ),
  }
}
