import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'
import { z } from 'zod'

import type { EntityScopeFilter } from '@/lib/entity-scope'
import type {
  DocumentErrorView,
  DocumentExtractedFieldsEditView,
  DocumentLogLevel,
  DocumentLogView,
  DocumentOverrideView,
  DocumentReviewFieldView,
  DocumentSigningStatus,
  DocumentTrailDetailView,
  DocumentTrailStatus,
  DocumentTrailStepView,
  DocumentValidationCheckView,
  OperationalDocumentView,
} from '@/lib/documents-types'
import type {
  IssueRouteSearch,
  IssueStatusFilter,
} from '@/lib/issue-search-state'
import type { ValidatedFilterSelections } from '@/lib/validated-filters'
import type {
  ValidatedRouteSearch,
  ValidatedSortBy,
  ValidatedSortDir,
} from '@/lib/validated-search-state'
import type { ValidatedTableRow } from '@/lib/validated-table-model'
import type { certificateOverrideRequests } from '@/lib/schema'
import type { AccessContext } from '@/lib/access-control'
import { canEditValidatedCertificateFields } from '@/lib/access-control'
import { formatAssignmentPeriodLabel } from '@/lib/certificate-merge-assignment'
import {
  getCertificateOverrideEligibility,
  getLatestOverrideRequestByResultId,
} from '@/lib/certificate-override-server'
import { getDb } from '@/lib/db'
import { resolveEntityScopeFilterById } from '@/lib/entities-server'
import {
  getSigningSummaries,
  getTemplateKeyForFile,
  getTemplatePlacementMap,
} from '@/lib/signing-server'
import {
  authUserTable,
  certificateMergeAssignments,
  documentResults,
  intakeBatches,
  intakeFiles,
  reconciliationResults,
  workerJobSteps,
  workerJobs,
} from '@/lib/schema'
import {
  isBatchReadyForSigning,
  resolveOverallStatus,
} from '@/lib/intake-utils'
import { DEFAULT_ISSUE_PAGE_SIZE } from '@/lib/issue-search-state'
import {
  DEFAULT_VALIDATED_PAGE_SIZE,
  decodeCsv,
} from '@/lib/validated-search-state'
import { filterValidatedRows } from '@/lib/validated-filters'
import { sortValidatedRows } from '@/lib/validated-sorters'
import {
  getMonthSortIndex,
  toValidatedTableRowsFromOperationalDocuments,
} from '@/lib/validated-table-model'
import { getEntityScopeCandidates } from '@/lib/entity-scope'
import { MANILA_TIME_ZONE_OFFSET_MS } from '@/lib/audit-search-state'

type DocumentResultRecord = typeof documentResults.$inferSelect
type IntakeBatchRecord = typeof intakeBatches.$inferSelect
type IntakeFileRecord = typeof intakeFiles.$inferSelect
type WorkerJobRecord = typeof workerJobs.$inferSelect
type WorkerJobStepRecord = typeof workerJobSteps.$inferSelect
type UserRecord = typeof authUserTable.$inferSelect
type OverrideRequestRecord = typeof certificateOverrideRequests.$inferSelect
type ReconciliationRecord = typeof reconciliationResults.$inferSelect
type MergeAssignmentRecord = typeof certificateMergeAssignments.$inferSelect

type DocumentListKind = 'validated' | 'issues' | 'all'

type ListOperationalDocumentsOptions = {
  limit?: number
  uploadDateRange?: {
    start: Date
    end: Date
  }
  entityFilter?: EntityScopeFilter | null
}

export type ValidatedDocumentPagination = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export type ValidatedDocumentSummary = {
  totalValidated: number
  certificateCount: number
  signedPdfCount: number
}

export type ValidatedDocumentFilterOptions = {
  year: Array<string>
  month: Array<string>
  quarter: Array<string>
  customerType: Array<string>
  errorType: Array<string>
  atc: Array<string>
}

export type ListValidatedDocumentsOptions = Pick<
  ValidatedRouteSearch,
  | 'q'
  | 'year'
  | 'month'
  | 'quarter'
  | 'entity'
  | 'customerType'
  | 'customerName'
  | 'errorType'
  | 'atc'
> & {
  entityId?: string | null
  sortBy?: ValidatedSortBy
  sortDir?: ValidatedSortDir
  page?: number | null
  pageSize?: number | null
  actor?: Pick<AccessContext, 'role' | 'userId'> | null
}

export type ListValidatedDocumentsResult = {
  documents: Array<OperationalDocumentView>
  pagination: ValidatedDocumentPagination
  summary: ValidatedDocumentSummary
  filterOptions: ValidatedDocumentFilterOptions
}

export type IssueDocumentPagination = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export type IssueDocumentSummary = {
  totalIssues: number
  errorCount: number
  duplicateCount: number
}

export type IssueDocumentFilterOptions = {
  severities: Array<string>
  owners: Array<string>
  years: Array<string>
  months: Array<string>
  quarters: Array<string>
}

export type ListIssueDocumentsOptions = Pick<
  IssueRouteSearch,
  | 'status'
  | 'q'
  | 'severity'
  | 'owner'
  | 'entity'
  | 'year'
  | 'month'
  | 'quarter'
  | 'dateFrom'
  | 'dateTo'
> & {
  entityId?: string | null
  page?: number | null
  pageSize?: number | null
}

export type ListIssueDocumentsResult = {
  documents: Array<OperationalDocumentView>
  pagination: IssueDocumentPagination
  summary: IssueDocumentSummary
  filterOptions: IssueDocumentFilterOptions
}

export type IssueDocumentsExportResult = {
  fileName: string
  content: Buffer
  contentType: string
  rowCount: number
}

type JsonRecord = Record<string, unknown>

type SortableLogEntry = {
  at: Date | null
  timestamp: string
  level: DocumentLogLevel
  message: string
}

const MULTIPLE_CERTIFICATE_REASON_CODE = 'multiple_certificate_pages_detected'

const buildDocumentBatchEntityFilter = (
  entityFilter: ListOperationalDocumentsOptions['entityFilter'],
) => {
  if (!entityFilter) return undefined

  const legacyNameFilters = getEntityScopeCandidates(entityFilter).flatMap(
    (candidate) => [
      sql`lower(trim(coalesce(${intakeBatches.entityShortName}, ''))) = ${candidate}`,
      sql`lower(trim(coalesce(${intakeBatches.entityCompanyName}, ''))) = ${candidate}`,
    ],
  )

  return or(eq(intakeBatches.entityId, entityFilter.id), ...legacyNameFilters)
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
    label: 'Validation + Variance',
    description: 'Validation and variance completed.',
    matches: (stepName) => stepName === 'validate_rules',
  },
  {
    label: 'Masterlist Check',
    description: 'Checked against masterlist.',
    matches: (stepName) => stepName === 'check_masterlist',
  },
  {
    label: 'Deduplication',
    description: 'Deduplication completed.',
    matches: (stepName) => stepName === 'dedupe_check',
  },
  {
    label: 'Rename + Persist',
    description: 'File renamed and persisted.',
    matches: (stepName) => stepName === 'persist_validated',
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

const hasRecordEntries = (record: JsonRecord) => Object.keys(record).length > 0

const getFirstCertificatePageNormalized = (
  payload: JsonRecord,
): JsonRecord | null => {
  const pages = Array.isArray(payload.pages) ? payload.pages : []

  for (const page of pages) {
    const pageRecord = toRecord(page)
    if (pageRecord.classification !== 'certificate') {
      continue
    }

    const normalized = toRecord(pageRecord.normalized)
    if (hasRecordEntries(normalized)) {
      return normalized
    }
  }

  return null
}

export const getDocumentResultNormalizedPayload = (
  payloadValue: unknown,
  reasonCodes: Array<string> = [],
): Record<string, unknown> => {
  const payload = toRecord(payloadValue)
  const normalized = toRecord(payload.normalized)

  if (reasonCodes.includes(MULTIPLE_CERTIFICATE_REASON_CODE)) {
    return getFirstCertificatePageNormalized(payload) ?? normalized
  }

  return normalized
}

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

export const EXTRACTED_FIELD_DEFINITIONS = [
  ['periodCovered', 'Period covered'],
  ['periodEnd', 'Period end'],
  ['monthOfQuarter', 'Month of quarter'],
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
  ['companyName', 'Signatory company name'],
] as const

const REVIEW_FIELD_DEFINITIONS = [
  ['periodStart', 'Period start'],
  ...EXTRACTED_FIELD_DEFINITIONS.filter(([key]) => key !== 'periodCovered'),
] as const
const VIRTUAL_EXTRACTED_FIELD_DEFINITIONS = [
  ['periodStart', 'Period start'],
] as const
const EDITABLE_EXTRACTED_FIELD_DEFINITIONS = [
  ...EXTRACTED_FIELD_DEFINITIONS,
  ...VIRTUAL_EXTRACTED_FIELD_DEFINITIONS,
] as const
const EXTRACTED_FIELDS_OVERRIDE_KEY = 'extractedFields'
const EXTRACTED_FIELD_VALUE_MAX = 800

const EDITABLE_EXTRACTED_FIELD_KEYS = EDITABLE_EXTRACTED_FIELD_DEFINITIONS.map(
  ([key]) => key,
)

type EditableExtractedFieldKey = (typeof EDITABLE_EXTRACTED_FIELD_KEYS)[number]

const REVIEW_TIN_FIELD_KEYS = new Set(['payeeTin', 'payorTin', 'signatoryTin'])
const REVIEW_MONEY_FIELD_KEYS = new Set<EditableExtractedFieldKey>([
  'taxBase',
  'taxWithheld',
])
const REVIEW_BOOLEAN_FIELD_KEYS = new Set<EditableExtractedFieldKey>([
  'signaturePresent',
])
const MONTH_OF_QUARTER_VALUES = ['first', 'second', 'third'] as const
const MONTH_OF_QUARTER_VALUE_SET = new Set<string>(MONTH_OF_QUARTER_VALUES)
type MonthOfQuarterValue = (typeof MONTH_OF_QUARTER_VALUES)[number]
const EDITABLE_EXTRACTED_FIELD_KEY_SET = new Set<string>(
  EDITABLE_EXTRACTED_FIELD_KEYS,
)

const extractedFieldValueSchema = z.union([
  z.string().max(EXTRACTED_FIELD_VALUE_MAX),
  z.number().finite(),
  z.boolean(),
  z.null(),
])

export const updateExtractedFieldsSchema = z
  .record(z.string(), extractedFieldValueSchema)
  .superRefine((fields, context) => {
    const entries = Object.entries(fields)
    if (entries.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'At least one extracted field is required.',
      })
      return
    }

    for (const [key, value] of entries) {
      if (!EDITABLE_EXTRACTED_FIELD_KEY_SET.has(key)) {
        context.addIssue({
          code: 'custom',
          message: `Unknown extracted field: ${key}.`,
        })
      }

      if (
        key === 'monthOfQuarter' &&
        value !== null &&
        (typeof value !== 'string' ||
          (value.trim().length > 0 &&
            !MONTH_OF_QUARTER_VALUE_SET.has(value.trim().toLowerCase())))
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Month of quarter must be first, second, or third.',
        })
      }
    }
  })

export type UpdateExtractedFieldsInput = z.infer<
  typeof updateExtractedFieldsSchema
>

const isEditableExtractedFieldKey = (
  value: string,
): value is EditableExtractedFieldKey =>
  EDITABLE_EXTRACTED_FIELD_KEY_SET.has(value)

const hasOwnKey = (record: JsonRecord, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key)

const getExtractedFieldLabel = (key: EditableExtractedFieldKey) =>
  EDITABLE_EXTRACTED_FIELD_DEFINITIONS.find(
    ([candidate]) => candidate === key,
  )?.[1] ?? key

const toRawReviewFieldValue = (
  value: unknown,
): string | number | boolean | null => {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  return null
}

const normalizeMoneyExtractedFieldValue = (
  key: EditableExtractedFieldKey,
  value: string | number | boolean | null,
) => {
  if (value === null) return null

  if (typeof value === 'number') {
    if (Number.isFinite(value)) return Number(value.toFixed(2))
    throw new Error(`${getExtractedFieldLabel(key)} must be a valid number.`)
  }

  if (typeof value === 'boolean') {
    throw new Error(`${getExtractedFieldLabel(key)} must be a valid number.`)
  }

  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Number(trimmed.replace(/[^\d.-]/gu, ''))
  if (!Number.isFinite(parsed)) {
    throw new Error(`${getExtractedFieldLabel(key)} must be a valid number.`)
  }

  return Number(parsed.toFixed(2))
}

const normalizeBooleanExtractedFieldValue = (
  key: EditableExtractedFieldKey,
  value: string | number | boolean | null,
) => {
  if (value === null) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0

  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (['true', '1', 'yes', 'y', 'present', 'signed'].includes(normalized)) {
    return true
  }
  if (['false', '0', 'no', 'n', 'absent', 'missing'].includes(normalized)) {
    return false
  }

  throw new Error(`${getExtractedFieldLabel(key)} must be yes or no.`)
}

const normalizeMonthOfQuarterExtractedFieldValue = (
  value: string | number | boolean | null,
): MonthOfQuarterValue | null => {
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new Error('Month of quarter must be first, second, or third.')
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (MONTH_OF_QUARTER_VALUE_SET.has(normalized)) {
    return normalized as MonthOfQuarterValue
  }

  throw new Error('Month of quarter must be first, second, or third.')
}

const normalizeTextExtractedFieldValue = (
  key: EditableExtractedFieldKey,
  value: string | number | boolean | null,
) => {
  if (value === null) return null
  const normalized =
    typeof value === 'string' ? value.trim() : String(value).trim()

  if (normalized.length > EXTRACTED_FIELD_VALUE_MAX) {
    throw new Error(
      `${getExtractedFieldLabel(key)} must be ${EXTRACTED_FIELD_VALUE_MAX} characters or fewer.`,
    )
  }

  return normalized || null
}

const toPeriodDateValue = (
  key: Extract<EditableExtractedFieldKey, 'periodStart' | 'periodEnd'>,
  value: unknown,
) => {
  const text = toStringValue(value)
  if (!text) {
    throw new Error(`${getExtractedFieldLabel(key)} must be a valid date.`)
  }

  const parsed = parseDateToken(text)
  if (!parsed) {
    throw new Error(`${getExtractedFieldLabel(key)} must be a valid date.`)
  }

  return parsed
}

const formatPeriodDateToken = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}-${date.getFullYear()}`
}

const getPeriodCoveredBoundaryValue = (
  value: unknown,
  boundary: 'start' | 'end',
) => {
  const text = toStringValue(value)
  if (!text) return null

  const rangeMatch =
    text.match(/^(.+?)\s+to\s+(.+)$/i) ?? text.match(/^(.+?)\s+-\s+(.+)$/)
  if (!rangeMatch) {
    return boundary === 'end' ? text : null
  }

  return boundary === 'start' ? rangeMatch[1] : rangeMatch[2]
}

const buildPeriodCoveredFromDates = (startDate: Date, endDate: Date) =>
  `${formatPeriodDateToken(startDate)} to ${formatPeriodDateToken(endDate)}`

const normalizeExtractedFieldValue = (
  key: EditableExtractedFieldKey,
  value: string | number | boolean | null,
) => {
  if (key === 'periodStart') {
    return formatPeriodDateToken(toPeriodDateValue(key, value))
  }

  if (key === 'periodEnd') {
    return formatPeriodDateToken(toPeriodDateValue(key, value))
  }

  if (REVIEW_MONEY_FIELD_KEYS.has(key)) {
    return normalizeMoneyExtractedFieldValue(key, value)
  }

  if (REVIEW_BOOLEAN_FIELD_KEYS.has(key)) {
    return normalizeBooleanExtractedFieldValue(key, value)
  }

  if (key === 'monthOfQuarter') {
    return normalizeMonthOfQuarterExtractedFieldValue(value)
  }

  return normalizeTextExtractedFieldValue(key, value)
}

const isSameExtractedFieldValue = (left: unknown, right: unknown) =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

const getNormalizedPeriodStartValue = (normalized: JsonRecord) =>
  normalized.periodStart ??
  getPeriodCoveredBoundaryValue(normalized.periodCovered, 'start')

export const buildNormalizedExtractedFieldsPatch = (
  currentNormalized: JsonRecord,
  fields: UpdateExtractedFieldsInput,
) => {
  const patch: JsonRecord = {}
  const hasPeriodStart = hasOwnKey(fields, 'periodStart')
  const hasPeriodEnd = hasOwnKey(fields, 'periodEnd')

  for (const [key, value] of Object.entries(fields)) {
    if (!isEditableExtractedFieldKey(key)) {
      throw new Error(`Unknown extracted field: ${key}.`)
    }

    if (key === 'periodStart') {
      continue
    }

    const normalizedValue = normalizeExtractedFieldValue(key, value)
    if (!isSameExtractedFieldValue(currentNormalized[key], normalizedValue)) {
      patch[key] = normalizedValue
    }
  }

  if (hasPeriodStart || hasPeriodEnd) {
    const periodStartSource = hasPeriodStart
      ? fields.periodStart
      : getNormalizedPeriodStartValue(currentNormalized)
    const periodEndSource = hasPeriodEnd
      ? fields.periodEnd
      : (currentNormalized.periodEnd ??
        getPeriodCoveredBoundaryValue(currentNormalized.periodCovered, 'end'))
    const periodStartDate = toPeriodDateValue('periodStart', periodStartSource)
    const periodEndDate = toPeriodDateValue('periodEnd', periodEndSource)

    if (periodStartDate.getTime() > periodEndDate.getTime()) {
      throw new Error('Period start must be on or before period end.')
    }

    const periodCovered = buildPeriodCoveredFromDates(
      periodStartDate,
      periodEndDate,
    )
    const periodStart = formatPeriodDateToken(periodStartDate)

    if (
      !isSameExtractedFieldValue(currentNormalized.periodStart, periodStart)
    ) {
      patch.periodStart = periodStart
    }

    if (
      !isSameExtractedFieldValue(currentNormalized.periodCovered, periodCovered)
    ) {
      patch.periodCovered = periodCovered
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('No extracted field changes were submitted.')
  }

  return patch
}

export const applyNormalizedPatchToPayload = (
  payloadValue: unknown,
  patch: JsonRecord,
) => {
  const payload = toRecord(payloadValue)
  const existingNormalized = toRecord(payload.normalized)
  let updatedFirstCertificatePage = false
  const pages = Array.isArray(payload.pages)
    ? payload.pages.map((page) => {
        const pageRecord = toRecord(page)
        if (
          updatedFirstCertificatePage ||
          pageRecord.classification !== 'certificate'
        ) {
          return page
        }

        const pageNormalized = toRecord(pageRecord.normalized)
        if (!hasRecordEntries(pageNormalized)) {
          return page
        }

        updatedFirstCertificatePage = true
        return {
          ...pageRecord,
          normalized: {
            ...pageNormalized,
            ...patch,
          },
        }
      })
    : undefined

  return {
    ...payload,
    normalized: {
      ...existingNormalized,
      ...patch,
    },
    ...(pages ? { pages } : {}),
  }
}

export const hasEditableCertificatePayload = (payloadValue: unknown) => {
  const payload = toRecord(payloadValue)
  const pages = Array.isArray(payload.pages) ? payload.pages : []
  if (pages.length > 0) {
    return pages.some((page) => toRecord(page).classification === 'certificate')
  }

  return hasRecordEntries(toRecord(payload.normalized))
}

const getExtractedFieldsEditPatch = (overridePatch: unknown): JsonRecord => {
  const patch = toRecord(overridePatch)
  return toRecord(patch[EXTRACTED_FIELDS_OVERRIDE_KEY])
}

export const buildNextExtractedFieldsOverridePatch = (input: {
  existingOverridePatch: unknown
  currentNormalized: JsonRecord
  normalizedPatch: JsonRecord
  editedAt: string
  editedByUserId: string
}) => {
  const existingOverridePatch = toRecord(input.existingOverridePatch)
  const existingEditPatch = getExtractedFieldsEditPatch(existingOverridePatch)
  const originalValues = {
    ...toRecord(existingEditPatch.originalValues),
  }
  const values = {
    ...toRecord(existingEditPatch.values),
  }

  for (const [key, value] of Object.entries(input.normalizedPatch)) {
    if (!hasOwnKey(originalValues, key)) {
      originalValues[key] = input.currentNormalized[key] ?? null
    }

    if (isSameExtractedFieldValue(originalValues[key], value)) {
      delete values[key]
      continue
    }

    values[key] = value
  }

  return {
    ...existingOverridePatch,
    [EXTRACTED_FIELDS_OVERRIDE_KEY]: {
      status: 'edited',
      editedAt: input.editedAt,
      editedByUserId: input.editedByUserId,
      originalValues,
      values,
    },
  }
}

const formatMonthOfQuarterValue = (value: unknown) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!MONTH_OF_QUARTER_VALUE_SET.has(normalized)) {
    return '—'
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

const formatReviewFieldValue = (
  key: EditableExtractedFieldKey,
  rawValue: unknown,
) => {
  const numeric = toNumberValue(rawValue)
  const formattedTin = REVIEW_TIN_FIELD_KEYS.has(key)
    ? formatTinForDisplay(rawValue)
    : ''

  if (key === 'monthOfQuarter') {
    return formatMonthOfQuarterValue(rawValue)
  }

  return REVIEW_TIN_FIELD_KEYS.has(key)
    ? formattedTin || '—'
    : typeof rawValue === 'boolean'
      ? rawValue
        ? 'Yes'
        : 'No'
      : numeric !== null
        ? NUMBER_FORMATTER.format(numeric)
        : toStringValue(rawValue) || '—'
}

const toOptionalFormattedIsoDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : toFormattedDate(date)
}

const buildExtractedFieldsEditView = (
  overridePatch: unknown,
  usersById: Map<string, UserRecord>,
): DocumentExtractedFieldsEditView | null => {
  const editPatch = getExtractedFieldsEditPatch(overridePatch)
  const values = toRecord(editPatch.values)
  const editedFields = Array.from(
    new Set(
      Object.keys(values)
        .filter(isEditableExtractedFieldKey)
        .map((key) =>
          key === 'periodCovered' && !hasOwnKey(values, 'periodStart')
            ? 'periodStart'
            : key,
        ),
    ),
  )
  const editedAt = toStringValue(editPatch.editedAt)
  if (!editedAt || editedFields.length === 0) {
    return null
  }

  const editedByUserId = toStringValue(editPatch.editedByUserId)
  const editor = editedByUserId ? usersById.get(editedByUserId) : undefined

  return {
    editedAt: toOptionalFormattedIsoDate(editedAt) ?? editedAt,
    editedByName: editor ? toDisplayUserName(editor) : undefined,
    editedFields,
  }
}

const buildReviewFields = (
  normalized: JsonRecord,
  overridePatch: unknown,
  usersById: Map<string, UserRecord>,
): Array<DocumentReviewFieldView> => {
  const confidenceMap = toRecord(normalized.confidenceMap)
  const editPatch = getExtractedFieldsEditPatch(overridePatch)
  const editedValues = toRecord(editPatch.values)
  const originalValues = toRecord(editPatch.originalValues)
  const editedAt = toStringValue(editPatch.editedAt)
  const editedByUserId = toStringValue(editPatch.editedByUserId)
  const editor = editedByUserId ? usersById.get(editedByUserId) : undefined

  return REVIEW_FIELD_DEFINITIONS.map(([key, label]) => {
    const isPeriodStart = key === 'periodStart'
    const rawValue = isPeriodStart
      ? getNormalizedPeriodStartValue(normalized)
      : normalized[key]
    const isEdited =
      hasOwnKey(editedValues, key) ||
      (isPeriodStart && hasOwnKey(editedValues, 'periodCovered'))
    const originalValue = isPeriodStart
      ? (originalValues.periodStart ??
        getPeriodCoveredBoundaryValue(originalValues.periodCovered, 'start'))
      : originalValues[key]
    const confidence = isPeriodStart
      ? (confidenceMap.periodStart ?? confidenceMap.periodCovered)
      : confidenceMap[key]

    return {
      key,
      label,
      rawValue: toRawReviewFieldValue(rawValue),
      value: formatReviewFieldValue(key, rawValue),
      confidence: formatFieldConfidence(confidence),
      source: isEdited ? 'edited' : 'original',
      originalValue: isEdited
        ? formatReviewFieldValue(key, originalValue)
        : undefined,
      editedAt:
        isEdited && editedAt ? toOptionalFormattedIsoDate(editedAt) : undefined,
      editedByName: isEdited && editor ? toDisplayUserName(editor) : undefined,
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
      message: 'File uploaded to the storage bucket.',
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
      'Reconciliation matched.',
    )
  }

  if (reconciliation.hasDifference) {
    return buildLifecycleTrailStep(
      'Reconciliation',
      'error',
      'Reconciliation variance remains open.',
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

export const buildDocumentTrail = (
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

export const buildDocumentTrailDetails = (
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
    return 'Uploaded to storage bucket'
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

const toDisplayUserName = (user: UserRecord | undefined) =>
  user?.name || user?.email || 'Unknown user'

const buildOverrideView = (
  request: OverrideRequestRecord | undefined,
  usersById: Map<string, UserRecord>,
): DocumentOverrideView | null => {
  if (!request) {
    return null
  }

  const decider = request.decidedByUserId
    ? usersById.get(request.decidedByUserId)
    : undefined

  return {
    requestId: request.id,
    status:
      request.status === 'approved' || request.status === 'rejected'
        ? request.status
        : 'pending',
    requestNote: request.requestNote,
    requestedAt: toFormattedDate(request.createdAt),
    requestedByName: toDisplayUserName(
      usersById.get(request.requestedByUserId),
    ),
    decisionNote: request.decisionNote ?? undefined,
    decidedAt: request.decidedAt
      ? toFormattedDate(request.decidedAt)
      : undefined,
    decidedByName: decider ? toDisplayUserName(decider) : undefined,
  }
}

const isBatchFileSigningReady = (file: IntakeFileRecord) =>
  resolveOverallStatus(file) === 'success'

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
          isBatchReadyForSigning({
            activeFileCount: batchFiles.length,
            successCount: batchFiles.filter(isBatchFileSigningReady).length,
          }),
      ] as const
    }),
  )
}

const buildDocumentViews = async (
  results: Array<DocumentResultRecord>,
  actor?: Pick<AccessContext, 'role' | 'userId'> | null,
) => {
  if (results.length === 0) {
    return [] satisfies Array<OperationalDocumentView>
  }

  const db = getDb()
  const uploadIds = results.map((result) => result.uploadId)
  const files = await db
    .select()
    .from(intakeFiles)
    .where(inArray(intakeFiles.id, uploadIds))

  const fileById = new Map(files.map((file) => [file.id, file]))
  const batchIds = Array.from(new Set(files.map((file) => file.batchId)))
  const batches =
    batchIds.length === 0
      ? []
      : await db
          .select()
          .from(intakeBatches)
          .where(inArray(intakeBatches.id, batchIds))
  const batchById = new Map(batches.map((batch) => [batch.id, batch]))
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

  const overrideRequestByResultId = await getLatestOverrideRequestByResultId(
    results.map((result) => result.id),
  )
  const overrideRequests = Array.from(overrideRequestByResultId.values())
  const userIds = Array.from(
    new Set(
      [
        ...files.map((file) => file.uploadedByUserId),
        ...results.map((result) => result.overriddenByUserId),
        ...overrideRequests.flatMap((request) => [
          request.requestedByUserId,
          request.decidedByUserId,
        ]),
      ].filter((value): value is string => Boolean(value)),
    ),
  )
  const users =
    userIds.length === 0
      ? []
      : await db
          .select()
          .from(authUserTable)
          .where(inArray(authUserTable.id, userIds))

  const userById = new Map<string, UserRecord>(
    users.map((user) => [user.id, user]),
  )
  const uploaderById = userById
  const successfulCertificateResults = results.filter(
    (result) => result.status === 'success',
  )
  const signingSummaries = await getSigningSummaries(
    successfulCertificateResults.map((result) => result.id),
  )
  const certificateResultIds = successfulCertificateResults.map(
    (result) => result.id,
  )
  const mergeAssignments =
    certificateResultIds.length === 0
      ? []
      : await db
          .select()
          .from(certificateMergeAssignments)
          .where(
            inArray(
              certificateMergeAssignments.documentResultId,
              certificateResultIds,
            ),
          )
          .orderBy(
            asc(certificateMergeAssignments.packageType),
            asc(certificateMergeAssignments.createdAt),
          )
  const mergeAssignmentsByResultId = new Map<
    number,
    Array<MergeAssignmentRecord>
  >()
  for (const assignment of mergeAssignments) {
    const current =
      mergeAssignmentsByResultId.get(assignment.documentResultId) ?? []
    current.push(assignment)
    mergeAssignmentsByResultId.set(assignment.documentResultId, current)
  }
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

    const batchRecord = batchById.get(fileRecord.batchId)
    const jobRecord = latestJobByUploadId.get(result.uploadId) ?? null
    const jobSteps = jobRecord ? (stepsByJobId.get(jobRecord.jobId) ?? []) : []
    const payload = toRecord(result.payload)
    const validationRecord = toRecord(result.validation)
    const reasonCodes = toStringArray(result.reasonCodes)
    const normalized = getDocumentResultNormalizedPayload(payload, [
      ...reasonCodes,
      ...toStringArray(validationRecord.reasons),
    ])
    const payee =
      toStringValue(normalized.payeeName) ||
      toStringValue(normalized.companyName) ||
      'Unknown payee'
    const payorName =
      toStringValue(normalized.payorName) ||
      toStringValue(result.payorName) ||
      'Unknown payor'
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
    const reviewFields = buildReviewFields(
      normalized,
      result.overridePatch,
      userById,
    )
    const extractedFieldsEdit = buildExtractedFieldsEditView(
      result.overridePatch,
      userById,
    )
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
    const overrideRequest = overrideRequestByResultId.get(result.id)
    const override = buildOverrideView(overrideRequest, userById)
    const overrideEligibility = getCertificateOverrideEligibility({
      result,
      removedFromBatchAt: fileRecord.removedFromBatchAt,
      existingRequests: overrideRequest ? [overrideRequest] : [],
    })
    const ownerRecord = uploaderById.get(fileRecord.uploadedByUserId)
    const owner = ownerRecord?.name || ownerRecord?.email || 'Unknown uploader'
    const canEditExtractedFields = actor
      ? canEditValidatedCertificateFields(actor, fileRecord.uploadedByUserId)
      : false
    const signingSummary =
      result.status === 'success' ? signingSummaries.get(result.id) : undefined
    const reconciliation =
      result.status === 'success'
        ? reconciliationByResultId.get(result.id)
        : undefined
    const canSign =
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
    return [
      {
        id: result.status === 'success' ? String(result.id) : fileRecord.id,
        documentResultId: result.id,
        kind: result.status === 'success' ? 'certificate' : 'upload',
        uploadId: fileRecord.id,
        uploadBatchId: fileRecord.batchId,
        removedFromBatchAt: toOptionalFormattedDate(
          fileRecord.removedFromBatchAt,
        ),
        fileName:
          result.status === 'success'
            ? toObjectFileName(result.finalKey) || fileRecord.originalFileName
            : fileRecord.originalFileName,
        uploadedAt: toFormattedDate(fileRecord.uploadedAt),
        sizeBytes: fileRecord.sizeBytes,
        status,
        stage,
        nextStep,
        payee,
        payorName,
        period: period.label,
        atc,
        taxBase,
        taxWithheld,
        confidence,
        year: period.year,
        month: period.month,
        quarter: period.quarter,
        entity:
          batchRecord?.entityShortName ||
          batchRecord?.entityCompanyName ||
          'Manual Upload',
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
        extractedFieldsEdit,
        canEditExtractedFields,
        override,
        canRequestOverride: overrideEligibility.eligible,
        canSign,
        signingStatus: signingSummary?.signingStatus ?? 'unsigned',
        signedAt: signingSummary?.signedAt,
        signedByName: signingSummary?.signedByName,
        signedPdfUrl: signingSummary?.signedPdfUrl,
        hasSavedTemplatePlacement:
          templatePlacementMap.get(getTemplateKeyForFile(fileRecord)) ?? false,
        mergeAssignments:
          result.status === 'success'
            ? (mergeAssignmentsByResultId.get(result.id) ?? []).map(
                (assignment) => {
                  const packageType =
                    assignment.packageType === 'annual' ? 'annual' : 'quarterly'
                  const assignmentStatus =
                    assignment.status === 'manual_review'
                      ? 'manual_review'
                      : 'assigned'

                  return {
                    packageType,
                    status: assignmentStatus,
                    sourcePeriod: formatAssignmentPeriodLabel({
                      packageType,
                      year: assignment.sourceYear,
                      quarter: assignment.sourceQuarter,
                    }),
                    sourceYear: assignment.sourceYear,
                    sourceQuarter: assignment.sourceQuarter,
                    assignedPeriod:
                      assignmentStatus === 'assigned'
                        ? formatAssignmentPeriodLabel({
                            packageType,
                            year: assignment.assignedYear,
                            quarter: assignment.assignedQuarter,
                          })
                        : 'Manual review',
                    assignedYear: assignment.assignedYear,
                    assignedQuarter: assignment.assignedQuarter,
                    isLate: assignment.isLate,
                    reason: assignment.reason,
                    updatedAt: toFormattedDate(assignment.updatedAt),
                  }
                },
              )
            : [],
      },
    ]
  })
}

export const listOperationalDocuments = async (
  kind: DocumentListKind,
  optionsOrLimit: ListOperationalDocumentsOptions | number = 200,
) => {
  const options =
    typeof optionsOrLimit === 'number'
      ? { limit: optionsOrLimit }
      : optionsOrLimit
  const limit = options.limit ?? 200
  const db = getDb()
  const statusFilter =
    kind === 'all'
      ? sql`true`
      : kind === 'validated'
        ? eq(documentResults.status, 'success')
        : sql`${documentResults.status} <> 'success'`

  if (options.uploadDateRange || options.entityFilter) {
    const uploadDateExpr = sql<Date>`coalesce(${intakeFiles.uploadedAt}, ${intakeFiles.createdAt})`
    const entityCondition = buildDocumentBatchEntityFilter(options.entityFilter)
    const rows = await db
      .select({ result: documentResults })
      .from(documentResults)
      .innerJoin(intakeFiles, eq(intakeFiles.id, documentResults.uploadId))
      .innerJoin(intakeBatches, eq(intakeBatches.id, intakeFiles.batchId))
      .where(
        and(
          statusFilter,
          isNull(intakeFiles.removedFromBatchAt),
          isNull(intakeBatches.deletedAt),
          options.uploadDateRange
            ? gte(uploadDateExpr, options.uploadDateRange.start)
            : undefined,
          options.uploadDateRange
            ? lt(uploadDateExpr, options.uploadDateRange.end)
            : undefined,
          entityCondition,
        ),
      )
      .orderBy(desc(documentResults.createdAt))
      .limit(limit)

    return buildDocumentViews(rows.map((row) => row.result))
  }

  const results = await db
    .select({ result: documentResults })
    .from(documentResults)
    .innerJoin(intakeFiles, eq(intakeFiles.id, documentResults.uploadId))
    .innerJoin(intakeBatches, eq(intakeBatches.id, intakeFiles.batchId))
    .where(
      and(
        statusFilter,
        isNull(intakeFiles.removedFromBatchAt),
        isNull(intakeBatches.deletedAt),
      ),
    )
    .orderBy(desc(documentResults.createdAt))
    .limit(Math.max(limit * 8, 200))

  const filteredResults = results
    .map((row) => row.result)
    .filter((result) =>
      kind === 'all'
        ? true
        : kind === 'validated'
          ? result.status === 'success'
          : result.status !== 'success',
    )

  return buildDocumentViews(filteredResults.slice(0, limit))
}

const compareText = (left: string, right: string) =>
  left.localeCompare(right, undefined, { sensitivity: 'base' })

const quarterToNumber = (quarter: string) => {
  const match = quarter.match(/^Q([1-4])$/i)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number.parseInt(match[1], 10)
}

const monthToNumber = (month: string) => {
  const monthIndex = getMonthSortIndex(month)
  return monthIndex < 0 ? Number.MAX_SAFE_INTEGER : monthIndex
}

const uniqueSortedValues = (
  values: Array<string>,
  sort: (left: string, right: string) => number = compareText,
) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort(
    sort,
  )

const getValidatedFilterOptions = (
  rows: Array<ValidatedTableRow>,
): ValidatedDocumentFilterOptions => ({
  year: uniqueSortedValues(rows.map((row) => row.year)),
  month: uniqueSortedValues(
    rows.map((row) => row.month),
    (left, right) => monthToNumber(left) - monthToNumber(right),
  ),
  quarter: uniqueSortedValues(
    rows.map((row) => row.quarter),
    (left, right) => quarterToNumber(left) - quarterToNumber(right),
  ),
  customerType: uniqueSortedValues(rows.map((row) => row.customerType)),
  errorType: uniqueSortedValues(rows.flatMap((row) => row.errorTypes)),
  atc: uniqueSortedValues(rows.map((row) => row.atc)),
})

const toValidatedFilterSelections = (
  input: ListValidatedDocumentsOptions,
): ValidatedFilterSelections => ({
  q: input.q,
  year: input.year,
  month: input.month,
  quarter: decodeCsv(input.quarter),
  entity: '',
  customerType: decodeCsv(input.customerType),
  customerName: input.customerName,
  errorType: decodeCsv(input.errorType),
  atc: decodeCsv(input.atc),
})

const hasExactEntity = (selectedEntity: string, rowEntity: string) => {
  const normalizedSelected = selectedEntity.trim().toLowerCase()
  if (!normalizedSelected) return true

  return rowEntity.trim().toLowerCase() === normalizedSelected
}

export const listValidatedDocuments = async (
  input: ListValidatedDocumentsOptions,
): Promise<ListValidatedDocumentsResult> => {
  const db = getDb()
  const entityFilter = await resolveEntityScopeFilterById(input.entityId)
  const results = entityFilter
    ? await db
        .select({ result: documentResults })
        .from(documentResults)
        .innerJoin(intakeFiles, eq(intakeFiles.id, documentResults.uploadId))
        .innerJoin(intakeBatches, eq(intakeBatches.id, intakeFiles.batchId))
        .where(
          and(
            eq(documentResults.status, 'success'),
            isNull(intakeFiles.removedFromBatchAt),
            isNull(intakeBatches.deletedAt),
            buildDocumentBatchEntityFilter(entityFilter),
          ),
        )
        .orderBy(desc(documentResults.createdAt))
    : await db
        .select({ result: documentResults })
        .from(documentResults)
        .innerJoin(intakeFiles, eq(intakeFiles.id, documentResults.uploadId))
        .innerJoin(intakeBatches, eq(intakeBatches.id, intakeFiles.batchId))
        .where(
          and(
            eq(documentResults.status, 'success'),
            isNull(intakeFiles.removedFromBatchAt),
            isNull(intakeBatches.deletedAt),
          ),
        )
        .orderBy(desc(documentResults.createdAt))

  const documents = await buildDocumentViews(
    results.map((row) => row.result),
    input.actor,
  )
  return buildValidatedDocumentsListResult(documents, {
    ...input,
    entity: entityFilter ? '' : input.entity,
  })
}

export const buildValidatedDocumentsListResult = (
  documents: Array<OperationalDocumentView>,
  input: ListValidatedDocumentsOptions,
): ListValidatedDocumentsResult => {
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.max(1, input.pageSize ?? DEFAULT_VALIDATED_PAGE_SIZE)
  const offset = (page - 1) * pageSize
  const tableRows = toValidatedTableRowsFromOperationalDocuments(documents)
  const filterOptions = getValidatedFilterOptions(tableRows)
  const filteredRows = filterValidatedRows(
    tableRows,
    toValidatedFilterSelections(input),
  ).filter((row) => hasExactEntity(input.entity, row.entity))
  const sortedRows = sortValidatedRows(filteredRows, {
    sortBy: input.sortBy ?? 'amount',
    sortDir: input.sortDir ?? 'desc',
  })
  const documentsById = new Map(
    documents.map((document) => [document.id, document]),
  )
  const filteredDocuments = sortedRows.flatMap((row) => {
    const docId = row.docId
    const document = documentsById.get(docId)
    return document ? [document] : []
  })
  const totalItems = filteredDocuments.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const pageDocuments = filteredDocuments.slice(offset, offset + pageSize)

  return {
    documents: pageDocuments,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: page * pageSize < totalItems,
      hasPreviousPage: page > 1,
    },
    summary: {
      totalValidated: totalItems,
      certificateCount: filteredDocuments.filter(
        (document) => document.kind === 'certificate',
      ).length,
      signedPdfCount: filteredDocuments.filter(
        (document) => document.signingStatus === 'signed',
      ).length,
    },
    filterOptions,
  }
}

const getIssueFilterOptions = (
  documents: Array<OperationalDocumentView>,
): IssueDocumentFilterOptions => ({
  severities: uniqueSortedValues(
    documents.map((document) => document.severity),
  ),
  owners: uniqueSortedValues(documents.map((document) => document.owner)),
  years: uniqueSortedValues(documents.map((document) => document.year)),
  months: uniqueSortedValues(
    documents.map((document) => document.month),
    (left, right) => monthToNumber(left) - monthToNumber(right),
  ),
  quarters: uniqueSortedValues(
    documents.map((document) => document.quarter),
    (left, right) => quarterToNumber(left) - quarterToNumber(right),
  ),
})

const ISSUE_DOCUMENTS_EXPORT_COLUMNS = [
  { key: 'fileName', header: 'File name' },
  { key: 'issueType', header: 'Issue type' },
  { key: 'issueReason', header: 'Issue reason' },
  { key: 'severity', header: 'Severity' },
  { key: 'owner', header: 'Owner' },
  { key: 'status', header: 'Status' },
  { key: 'stage', header: 'Stage' },
  { key: 'nextStep', header: 'Next step' },
  { key: 'entity', header: 'Entity' },
  { key: 'payee', header: 'Payee' },
  { key: 'payor', header: 'Payor' },
  { key: 'period', header: 'Period' },
  { key: 'year', header: 'Year' },
  { key: 'month', header: 'Month' },
  { key: 'quarter', header: 'Quarter' },
  { key: 'atc', header: 'ATC' },
  { key: 'taxBase', header: 'Tax base' },
  { key: 'taxWithheld', header: 'Tax withheld' },
  { key: 'confidence', header: 'Confidence' },
  { key: 'updatedAt', header: 'Updated at' },
  { key: 'uploadedAt', header: 'Uploaded at' },
] as const

type IssueDocumentsExportColumnKey =
  (typeof ISSUE_DOCUMENTS_EXPORT_COLUMNS)[number]['key']
type IssueDocumentsExportRow = Record<IssueDocumentsExportColumnKey, string>

const matchesExactText = (selected: string, actual: string) => {
  const normalizedSelected = selected.trim().toLowerCase()
  if (!normalizedSelected) return true

  return actual.trim().toLowerCase() === normalizedSelected
}

const toIssueStatus = (status: IssueStatusFilter) => {
  switch (status) {
    case 'error':
      return 'Error'
    case 'duplicate':
      return 'Duplicate'
    default:
      return null
  }
}

const toIssueBoundaryMs = (
  value: string,
  boundary: 'start' | 'end',
): number | null => {
  if (!value) return null

  const parsed = new Date(`${value}T00:00:00`)
  const time = parsed.getTime()
  if (Number.isNaN(time)) return null

  return boundary === 'start' ? time : time + 24 * 60 * 60 * 1000 - 1
}

const getDocumentUpdatedMs = (document: OperationalDocumentView) => {
  const parsed = new Date(document.updatedAt)
  const time = parsed.getTime()
  return Number.isNaN(time) ? null : time
}

const isWithinIssueUpdatedRange = (
  document: OperationalDocumentView,
  input: Pick<ListIssueDocumentsOptions, 'dateFrom' | 'dateTo'>,
) => {
  const from = toIssueBoundaryMs(input.dateFrom, 'start')
  const to = toIssueBoundaryMs(input.dateTo, 'end')
  if (from === null && to === null) return true

  const updatedAt = getDocumentUpdatedMs(document)
  if (updatedAt === null) return false

  const lower = Math.min(
    from ?? Number.NEGATIVE_INFINITY,
    to ?? Number.POSITIVE_INFINITY,
  )
  const upper = Math.max(
    from ?? Number.NEGATIVE_INFINITY,
    to ?? Number.POSITIVE_INFINITY,
  )

  return updatedAt >= lower && updatedAt <= upper
}

const matchesIssueSearch = (
  document: OperationalDocumentView,
  query: string,
) => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  return [
    document.fileName,
    document.issueReason,
    document.owner,
    document.entity,
    document.status,
    document.severity,
  ].some((value) => value.toLowerCase().includes(normalized))
}

const filterIssuesWithoutStatus = (
  documents: Array<OperationalDocumentView>,
  input: ListIssueDocumentsOptions,
) =>
  documents.filter(
    (document) =>
      matchesIssueSearch(document, input.q) &&
      matchesExactText(input.severity, document.severity) &&
      matchesExactText(input.owner, document.owner) &&
      matchesExactText(input.entity, document.entity) &&
      matchesExactText(input.year, document.year) &&
      matchesExactText(input.month, document.month) &&
      matchesExactText(input.quarter, document.quarter) &&
      isWithinIssueUpdatedRange(document, input),
  )

const filterIssuesByStatus = (
  documents: Array<OperationalDocumentView>,
  status: IssueStatusFilter,
) => {
  const expectedStatus = toIssueStatus(status)
  if (!expectedStatus) return documents

  return documents.filter((document) => document.status === expectedStatus)
}

const getFilteredIssueDocuments = (
  documents: Array<OperationalDocumentView>,
  input: ListIssueDocumentsOptions,
) => {
  const matchingDocuments = filterIssuesWithoutStatus(documents, input)
  const filteredDocuments = filterIssuesByStatus(
    matchingDocuments,
    input.status,
  )

  return {
    matchingDocuments,
    filteredDocuments,
  }
}

const escapeIssueCsvValue = (
  value: string | number | boolean | null | undefined,
) => {
  const text =
    value === null || typeof value === 'undefined' ? '' : String(value)
  if (!/[",\r\n]/.test(text)) {
    return text
  }

  return `"${text.replaceAll('"', '""')}"`
}

const getIssueTypeLabel = (document: OperationalDocumentView) => {
  if (document.status === 'Duplicate') return 'Duplicate'
  if (document.status === 'Error') return 'Validation failure'

  return document.status
}

const toIssueExportKnownValue = (value: string) =>
  value.trim() && value !== '—' ? value : 'Unknown'

const toIssueDocumentsExportRow = (
  document: OperationalDocumentView,
): IssueDocumentsExportRow => ({
  fileName: document.fileName,
  issueType: getIssueTypeLabel(document),
  issueReason: document.issueReason,
  severity: document.severity,
  owner: document.owner,
  status: document.status,
  stage: document.stage,
  nextStep: document.nextStep,
  entity: document.entity,
  payee: document.payee,
  payor: document.payorName,
  period: document.period,
  year: document.year,
  month: document.month,
  quarter: document.quarter,
  atc: toIssueExportKnownValue(document.atc),
  taxBase: toIssueExportKnownValue(document.taxBase),
  taxWithheld: toIssueExportKnownValue(document.taxWithheld),
  confidence: toIssueExportKnownValue(document.confidence),
  updatedAt: document.updatedAt,
  uploadedAt: document.uploadedAt ?? '',
})

const buildIssueDocumentsCsv = (rows: Array<IssueDocumentsExportRow>) => {
  const csvRows = [
    ISSUE_DOCUMENTS_EXPORT_COLUMNS.map((column) => column.header),
    ...rows.map((row) =>
      ISSUE_DOCUMENTS_EXPORT_COLUMNS.map((column) => row[column.key]),
    ),
  ]

  return `${csvRows
    .map((row) => row.map((value) => escapeIssueCsvValue(value)).join(','))
    .join('\n')}\n`
}

const pad2 = (value: number) => String(value).padStart(2, '0')

const formatIssueExportFileTimestamp = (date: Date) => {
  const manilaDate = new Date(date.getTime() + MANILA_TIME_ZONE_OFFSET_MS)

  return `${manilaDate.getUTCFullYear()}${pad2(
    manilaDate.getUTCMonth() + 1,
  )}${pad2(manilaDate.getUTCDate())}-${pad2(
    manilaDate.getUTCHours(),
  )}${pad2(manilaDate.getUTCMinutes())}${pad2(manilaDate.getUTCSeconds())}`
}

export const buildIssueDocumentsExportFileName = (date = new Date()) =>
  `Issues-Queue-${formatIssueExportFileTimestamp(date)}.csv`

export const buildIssueDocumentsExport = (
  documents: Array<OperationalDocumentView>,
  input: ListIssueDocumentsOptions,
  date = new Date(),
): IssueDocumentsExportResult => {
  const { filteredDocuments } = getFilteredIssueDocuments(documents, input)
  const rows = filteredDocuments.map(toIssueDocumentsExportRow)

  return {
    fileName: buildIssueDocumentsExportFileName(date),
    content: Buffer.from(buildIssueDocumentsCsv(rows), 'utf8'),
    contentType: 'text/csv; charset=utf-8',
    rowCount: rows.length,
  }
}

export const buildIssueDocumentsListResult = (
  documents: Array<OperationalDocumentView>,
  input: ListIssueDocumentsOptions,
): ListIssueDocumentsResult => {
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.max(1, input.pageSize ?? DEFAULT_ISSUE_PAGE_SIZE)
  const offset = (page - 1) * pageSize
  const filterOptions = getIssueFilterOptions(documents)
  const { matchingDocuments, filteredDocuments } = getFilteredIssueDocuments(
    documents,
    input,
  )
  const totalItems = filteredDocuments.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const pageDocuments = filteredDocuments.slice(offset, offset + pageSize)

  return {
    documents: pageDocuments,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: page * pageSize < totalItems,
      hasPreviousPage: page > 1,
    },
    summary: {
      totalIssues: matchingDocuments.length,
      errorCount: matchingDocuments.filter(
        (document) => document.status === 'Error',
      ).length,
      duplicateCount: matchingDocuments.filter(
        (document) => document.status === 'Duplicate',
      ).length,
    },
    filterOptions,
  }
}

const getIssueDocumentViews = async (input: ListIssueDocumentsOptions) => {
  const db = getDb()
  const entityFilter = await resolveEntityScopeFilterById(input.entityId)
  const results = entityFilter
    ? await db
        .select({ result: documentResults })
        .from(documentResults)
        .innerJoin(intakeFiles, eq(intakeFiles.id, documentResults.uploadId))
        .innerJoin(intakeBatches, eq(intakeBatches.id, intakeFiles.batchId))
        .where(
          and(
            sql`${documentResults.status} <> 'success'`,
            isNull(intakeFiles.removedFromBatchAt),
            isNull(intakeBatches.deletedAt),
            buildDocumentBatchEntityFilter(entityFilter),
          ),
        )
        .orderBy(desc(documentResults.createdAt))
    : await db
        .select({ result: documentResults })
        .from(documentResults)
        .innerJoin(intakeFiles, eq(intakeFiles.id, documentResults.uploadId))
        .innerJoin(intakeBatches, eq(intakeBatches.id, intakeFiles.batchId))
        .where(
          and(
            sql`${documentResults.status} <> 'success'`,
            isNull(intakeFiles.removedFromBatchAt),
            isNull(intakeBatches.deletedAt),
          ),
        )
        .orderBy(desc(documentResults.createdAt))

  const documents = await buildDocumentViews(results.map((row) => row.result))

  return {
    documents,
    entityFilter,
  }
}

export const listIssueDocuments = async (
  input: ListIssueDocumentsOptions,
): Promise<ListIssueDocumentsResult> => {
  const { documents, entityFilter } = await getIssueDocumentViews(input)

  return buildIssueDocumentsListResult(documents, {
    ...input,
    entity: entityFilter ? '' : input.entity,
  })
}

export const exportIssueDocuments = async (
  input: ListIssueDocumentsOptions,
): Promise<IssueDocumentsExportResult> => {
  const { documents, entityFilter } = await getIssueDocumentViews(input)

  return buildIssueDocumentsExport(documents, {
    ...input,
    entity: entityFilter ? '' : input.entity,
  })
}

const toNullableResultText = (value: unknown) => {
  const text = toStringValue(value)
  return text || null
}

const toDateColumnValue = (value: unknown) => {
  const text = toStringValue(value)
  if (!text) return null

  const parsed = parseDateToken(text)
  if (!parsed) return null

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseDocumentResultId = (documentId: string) => {
  if (!/^\d+$/u.test(documentId)) {
    throw new Error('Invalid document id.')
  }

  const parsed = Number.parseInt(documentId, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('Invalid document id.')
  }

  return parsed
}

export const updateDocumentExtractedFields = async (input: {
  documentId: string
  actor: Pick<AccessContext, 'role' | 'userId'>
  fields: UpdateExtractedFieldsInput
}) => {
  const resultId = parseDocumentResultId(input.documentId)
  const db = getDb()
  const result = (
    await db
      .select()
      .from(documentResults)
      .where(eq(documentResults.id, resultId))
      .limit(1)
  ).at(0)

  if (!result) {
    throw new Error('Document not found.')
  }

  if (result.status !== 'success') {
    throw new Error('Only validated certificate results can be edited.')
  }

  if (!hasEditableCertificatePayload(result.payload)) {
    throw new Error('Only validated certificate results can be edited.')
  }

  const fileRecord = (
    await db
      .select()
      .from(intakeFiles)
      .where(eq(intakeFiles.id, result.uploadId))
      .limit(1)
  ).at(0)
  if (!fileRecord) {
    throw new Error('Document not found.')
  }

  if (
    !canEditValidatedCertificateFields(input.actor, fileRecord.uploadedByUserId)
  ) {
    throw new Error('You do not have permission to update extracted fields.')
  }

  const signingSummary = (await getSigningSummaries([result.id])).get(result.id)
  if (signingSummary?.signingStatus === 'signed') {
    throw new Error('Signed certificates cannot be edited.')
  }

  const validationRecord = toRecord(result.validation)
  const reasonCodes = [
    ...toStringArray(result.reasonCodes),
    ...toStringArray(validationRecord.reasons),
  ]
  const payload = toRecord(result.payload)
  const currentNormalized = getDocumentResultNormalizedPayload(
    payload,
    reasonCodes,
  )
  const normalizedPatch = buildNormalizedExtractedFieldsPatch(
    currentNormalized,
    input.fields,
  )
  const updatedPayload = applyNormalizedPatchToPayload(payload, normalizedPatch)
  const updatedNormalized = {
    ...currentNormalized,
    ...normalizedPatch,
  }
  const editedAt = new Date()
  const overridePatch = buildNextExtractedFieldsOverridePatch({
    existingOverridePatch: result.overridePatch,
    currentNormalized,
    normalizedPatch,
    editedAt: editedAt.toISOString(),
    editedByUserId: input.actor.userId,
  })

  const updated = (
    await db
      .update(documentResults)
      .set({
        payload: updatedPayload,
        periodEnd: toDateColumnValue(updatedNormalized.periodEnd),
        payeeName: toNullableResultText(updatedNormalized.payeeName),
        payeeTin: toNullableResultText(updatedNormalized.payeeTin),
        payorName: toNullableResultText(updatedNormalized.payorName),
        payorTin: toNullableResultText(updatedNormalized.payorTin),
        overriddenAt: editedAt,
        overriddenByUserId: input.actor.userId,
        overridePatch,
      })
      .where(eq(documentResults.id, result.id))
      .returning()
  ).at(0)

  if (!updated) {
    throw new Error('Unable to update extracted fields.')
  }

  return (await buildDocumentViews([updated], input.actor))[0]
}

export const getOperationalDocument = async (
  documentId: string,
  actor?: Pick<AccessContext, 'role' | 'userId'> | null,
) => {
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
      const [document] = await buildDocumentViews([result], actor)
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
      removedFromBatchAt: toOptionalFormattedDate(
        fileRecord.removedFromBatchAt,
      ),
      fileName: fileRecord.originalFileName,
      uploadedAt: toFormattedDate(fileRecord.uploadedAt),
      sizeBytes: fileRecord.sizeBytes,
      status,
      stage,
      nextStep,
      payee: 'Unknown payee',
      payorName: 'Unknown payor',
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
      override: null,
      canRequestOverride: false,
      canSign: false,
      signingStatus: 'unsigned',
      signedAt: undefined,
      signedByName: undefined,
      signedPdfUrl: undefined,
      hasSavedTemplatePlacement: false,
    }
  }

  const documents = await buildDocumentViews(results, actor)
  const document = documents.at(0)
  if (!document) {
    return null
  }

  return {
    ...document,
    id: documentId,
    uploadId: documentId,
  }
}
