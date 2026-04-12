import { asc, desc, eq, inArray } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import type {
  DocumentErrorView,
  DocumentLogLevel,
  DocumentLogView,
  DocumentTrailStepView,
  OperationalDocumentView,
} from '@/lib/documents-types'
import {
  authUserTable,
  documentResults,
  intakeFiles,
  workerJobs,
  workerJobSteps,
} from '@/lib/schema'

type DocumentResultRecord = typeof documentResults.$inferSelect
type IntakeFileRecord = typeof intakeFiles.$inferSelect
type WorkerJobRecord = typeof workerJobs.$inferSelect
type WorkerJobStepRecord = typeof workerJobSteps.$inferSelect
type UserRecord = typeof authUserTable.$inferSelect

type DocumentListKind = 'validated' | 'issues'

type JsonRecord = Record<string, unknown>

type SortableLogEntry = {
  at: Date | null
  timestamp: string
  level: DocumentLogLevel
  message: string
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
  validate_rules: 'Validation + Variance',
  dedupe_check: 'Deduplication',
  persist_validation_fail: 'Persist validation failure',
  persist_duplicate: 'Persist duplicate result',
  persist_validated: 'Rename + Persist',
  reconcile_document: 'Reconciliation',
  finalize_workflow: 'Finalize workflow',
  workflow: 'Workflow',
}

const PIPELINE_STEPS: Array<{
  label: string
  detail?: string
  matches: (stepName: string) => boolean
}> = [
  {
    label: 'Uploaded',
    matches: () => false,
  },
  {
    label: 'Queued',
    matches: () => false,
  },
  {
    label: 'OCR / Layout',
    matches: (stepName) =>
      stepName === 'load_input' || stepName === 'extract_document',
  },
  {
    label: 'AI Normalize',
    matches: (stepName) => stepName === 'normalize_fields',
  },
  {
    label: 'Validation + Variance',
    matches: (stepName) => stepName === 'validate_rules',
  },
  {
    label: 'Deduplication',
    matches: (stepName) => stepName === 'dedupe_check',
  },
  {
    label: 'Rename + Persist',
    matches: (stepName) =>
      stepName === 'persist_validation_fail' ||
      stepName === 'persist_duplicate' ||
      stepName === 'persist_validated' ||
      stepName === 'finalize_workflow',
  },
  {
    label: 'Reconciliation',
    matches: (stepName) => stepName === 'reconcile_document',
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
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

const toFormattedDate = (value: Date | null | undefined) =>
  value ? DATE_FORMATTER.format(value) : '—'

const toSortableDate = (value: Date | null | undefined) => value ?? null

const humanizeToken = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (token) => token.toUpperCase())

const classifyErrorType = (value: string) => {
  const normalized = value.toLowerCase()
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

  const average = entries.reduce((acc, entry) => acc + entry, 0) / entries.length
  return average.toFixed(2)
}

const formatElapsed = (start: Date | null | undefined, end: Date | null | undefined) => {
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

  const isoCandidate = new Date(trimmed)
  if (!Number.isNaN(isoCandidate.getTime())) {
    return isoCandidate
  }

  const usMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!usMatch) {
    return null
  }

  const month = Number.parseInt(usMatch[1], 10) - 1
  const day = Number.parseInt(usMatch[2], 10)
  const year = Number.parseInt(usMatch[3], 10)
  const date = new Date(year, month, day)
  return Number.isNaN(date.getTime()) ? null : date
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
    const month = MONTHS[Number.parseInt(quarterMatch[1], 10) * 3 - 1] ?? 'Unknown'

    return {
      label: `${quarter} ${year}`,
      year,
      month,
      quarter,
    }
  }

  const parsedDate = parseDateToken(trimmed)
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
  if (validationReasons.length > 0) {
    return humanizeToken(validationReasons[0])
  }

  if (errors.length > 0) {
    return errors[0].message
  }

  if (reasonCodes.length > 0) {
    return humanizeToken(reasonCodes[0])
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
        message: reasonCodes.length > 0 ? humanizeToken(reasonCodes[0]) : 'Document flagged as duplicate.',
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

const buildDocumentTrail = (
  fileRecord: IntakeFileRecord,
  jobRecord: WorkerJobRecord | null,
  resultStatus: string,
  issueReason: string,
  steps: Array<WorkerJobStepRecord>,
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
        : fileRecord.queueStatus === 'queued' || fileRecord.queueStatus === 'sending'
          ? 'active'
          : fileRecord.queueStatus === 'failed'
            ? 'error'
            : 'pending',
    detail:
      fileRecord.queueStatus === 'failed'
        ? fileRecord.errorMessage ?? 'Queue submission failed.'
        : undefined,
  }

  for (const [index, pipelineStep] of PIPELINE_STEPS.entries()) {
    if (index < 2) {
      continue
    }

    const matchingSteps = steps.filter((step) => pipelineStep.matches(step.stepName))
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

  if (resultStatus === 'Ready') {
    return trail.map((step, index) =>
      index === trail.length - 1 ? { ...step, status: 'complete' } : step,
    )
  }

  return trail
}

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
    toStringValue(jobRecord?.currentStep) || toStringValue(fileRecord.currentStep)
  const currentPhase =
    toStringValue(jobRecord?.currentPhase) || toStringValue(fileRecord.currentPhase)

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
    toStringValue(jobRecord?.currentStep) || toStringValue(fileRecord.currentStep)

  if (status === 'Processing') {
    return currentStep ? humanizeToken(currentStep) : 'Continue worker processing'
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
      stage: humanizeToken(jobRecord?.currentStep ?? fileRecord.currentStep ?? 'upload'),
      message:
        fileRecord.errorMessage ||
        jobRecord?.errorSummary ||
        'Upload processing failed before a terminal result was recorded.',
    },
  ]
}

const toLatestByKey = <TItem, TKey extends string>(
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

const fetchLatestResults = async (limit: number) => {
  const db = getDb()
  const rows = await db
    .select()
    .from(documentResults)
    .orderBy(desc(documentResults.createdAt))
    .limit(Math.max(limit * 8, 200))

  const latestByUploadId = toLatestByKey(rows, (row) => row.uploadId)
  return Array.from(latestByUploadId.values()).slice(0, limit)
}

const buildDocumentViews = async (
  results: Array<DocumentResultRecord>,
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

  return results.flatMap<OperationalDocumentView>((result) => {
    const fileRecord = fileById.get(result.uploadId)
    if (!fileRecord) {
      return []
    }

    const jobRecord = latestJobByUploadId.get(result.uploadId) ?? null
    const jobSteps = jobRecord ? stepsByJobId.get(jobRecord.jobId) ?? [] : []
    const payload = toRecord(result.payload)
    const normalized = toRecord(payload.normalized)
    const validationRecord = toRecord(result.validation)
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
      toNumberValue(normalized.taxBase) ?? toNumberValue(validationRecord.reportedTaxBase),
    )
    const taxWithheld = formatCurrency(
      toNumberValue(normalized.taxWithheld),
    )
    const confidence = formatConfidence(normalized.confidenceMap)
    const errors = buildDocumentErrors(result.status, validationRecord, reasonCodes, jobSteps)
    const issueReason = buildIssueReason(validationRecord, reasonCodes, errors)
    const errorTypes =
      errors.length > 0
        ? Array.from(new Set(errors.map((error) => classifyErrorType(error.message))))
        : ['None']
    const status =
      result.status === 'success'
        ? 'Ready'
        : result.status === 'duplicate'
          ? 'Duplicate'
          : 'Error'
    const ownerRecord = uploaderById.get(fileRecord.uploadedByUserId)
    const owner = ownerRecord?.name || ownerRecord?.email || 'Unknown uploader'
    const updatedAtValue =
      jobRecord?.updatedAt ?? fileRecord.updatedAt ?? result.createdAt
    const processingUpdatedAt = jobRecord?.updatedAt ?? result.createdAt
    const processingStartedAt = jobRecord?.startedAt ?? fileRecord.processingStartedAt
    const processingFinishedAt = jobRecord?.finishedAt ?? fileRecord.processingFinishedAt
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
    )
    const logs = buildDocumentLogs(fileRecord, jobSteps)

    return [
      {
        id: fileRecord.id,
        batchId: fileRecord.batchId,
        fileName: fileRecord.originalFileName,
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
        logs,
        errors,
      },
    ]
  })
}

export const listOperationalDocuments = async (
  kind: DocumentListKind,
  limit = 200,
) => {
  const results = await fetchLatestResults(limit)
  const filteredResults = results.filter((result) =>
    kind === 'validated' ? result.status === 'success' : result.status !== 'success',
  )

  return buildDocumentViews(filteredResults)
}

export const getOperationalDocument = async (documentId: string) => {
  const db = getDb()
  const results = await db
    .select()
    .from(documentResults)
    .where(eq(documentResults.uploadId, documentId))
    .orderBy(desc(documentResults.createdAt))
    .limit(1)

  if (results.length === 0) {
    const [fileRecord] = await db
      .select()
      .from(intakeFiles)
      .where(eq(intakeFiles.id, documentId))
      .limit(1)

    if (!fileRecord) {
      return null
    }

    const [jobRecord] = await db
      .select()
      .from(workerJobs)
      .where(eq(workerJobs.uploadId, documentId))
      .orderBy(desc(workerJobs.createdAt))
      .limit(1)

    const steps =
      jobRecord
        ? await db
            .select()
            .from(workerJobSteps)
            .where(eq(workerJobSteps.jobId, jobRecord.jobId))
            .orderBy(asc(workerJobSteps.createdAt))
        : []

    const [ownerRecord] = await db
      .select()
      .from(authUserTable)
      .where(eq(authUserTable.id, fileRecord.uploadedByUserId))
      .limit(1)

    const status = deriveLiveStatus(fileRecord, jobRecord ?? null)
    const stage = deriveLiveStage(status, fileRecord, jobRecord ?? null)
    const nextStep = deriveLiveNextStep(status, fileRecord, jobRecord ?? null)
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
    const errors = buildLiveDocumentErrors(
      status,
      fileRecord,
      jobRecord ?? null,
      steps,
    )

    return {
      id: fileRecord.id,
      batchId: fileRecord.batchId,
      fileName: fileRecord.originalFileName,
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
      updatedAt: toFormattedDate(
        jobRecord?.updatedAt ?? fileRecord.updatedAt ?? fileRecord.createdAt,
      ),
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
      trail: buildDocumentTrail(
        fileRecord,
        jobRecord ?? null,
        status,
        issueReason,
        steps,
      ),
      logs: buildDocumentLogs(fileRecord, steps),
      errors,
    }
  }

  const documents = await buildDocumentViews(results)
  return documents[0] ?? null
}
