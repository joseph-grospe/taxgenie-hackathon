import { createHash } from 'node:crypto'

import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  buildOptionalCustomerStorageKey,
  buildOptionalEntityStorageKey,
  buildProcessingArtifactKey,
  buildUnsignedCertificateFileName,
  buildUnsignedCertificateKey,
  formatCertificatePeriodKey,
  parseCertificateFileName,
} from '@taxtrack/shared'
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'
import type { SQL } from 'drizzle-orm'
import type { EntityStorageInput } from '@taxtrack/shared'

import { getDb } from '@/lib/db'
import {
  createS3ServerClient,
  getStorageBucketName,
  getStoragePrefix,
} from '@/lib/aws-server'
import {
  authUserTable,
  certificateOverrideRequests,
  documentResults,
  intakeBatches,
  intakeFiles,
  masterlist,
  reconciliationResults,
  salesReportRunBatches,
  salesReportRuns,
} from '@/lib/schema'

type DocumentResultRecord = typeof documentResults.$inferSelect
type OverrideRequestRecord = typeof certificateOverrideRequests.$inferSelect
type DbClient = ReturnType<typeof getDb>
type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0]

type JsonRecord = Record<string, unknown>
type IntakeBatchRecord = typeof intakeBatches.$inferSelect
type IntakeFileRecord = typeof intakeFiles.$inferSelect

export type CertificateOverrideStatus = 'pending' | 'approved' | 'rejected'

export type CertificateOverrideRequestView = {
  id: string
  documentResultId: number
  uploadId: string
  batchId: string
  status: CertificateOverrideStatus
  fileName: string
  entity: string
  payee: string
  payorName: string
  payorTin: string
  issueReason: string
  requestNote: string
  requestedAt: string
  requestedByName: string
  requestedByEmail: string | null
  decidedAt: string | null
  decidedByName: string | null
  decisionNote: string | null
}

export type CertificateOverrideListResult = {
  requests: Array<CertificateOverrideRequestView>
  summary: {
    pending: number
    approved: number
    rejected: number
  }
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
}

export const certificateOverrideStatuses = [
  'pending',
  'approved',
  'rejected',
] as const

export const certificateOverridePageSizeOptions = [10, 25, 50, 100] as const
export const DEFAULT_CERTIFICATE_OVERRIDE_PAGE_SIZE = 25

const NOTE_MAX = 1200
const OVERRIDE_SEARCH_MAX = 160

export const createCertificateOverrideRequestSchema = z.object({
  documentResultId: z.number().int().positive(),
  requestNote: z
    .string()
    .trim()
    .min(1, 'Request note is required.')
    .max(NOTE_MAX, 'Request note must be 1200 characters or fewer.'),
})

export const decideCertificateOverrideRequestSchema = z.object({
  decisionNote: z
    .string()
    .trim()
    .min(1, 'Decision note is required.')
    .max(NOTE_MAX, 'Decision note must be 1200 characters or fewer.'),
})

export type CreateCertificateOverrideRequestInput = z.infer<
  typeof createCertificateOverrideRequestSchema
> & {
  userId: string
}

export type DecideCertificateOverrideRequestInput = z.infer<
  typeof decideCertificateOverrideRequestSchema
> & {
  requestId: string
  userId: string
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toRecord = (value: unknown): JsonRecord => (isRecord(value) ? value : {})

const toNullableRecord = (value: unknown): JsonRecord | null =>
  isRecord(value) ? value : null

const toStringArray = (value: unknown): Array<string> =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

const normalizeTinDigits = (value: string | null | undefined) =>
  (value ?? '').replace(/\D/gu, '')

const escapeLikePattern = (value: string) => value.replaceAll(/[%_\\]/g, '\\$&')

const normalizeTextValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

const normalizeIdentityName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9]/gu, '')
    .toLowerCase()
  return normalized.length > 0 ? normalized : null
}

const compactMasterlistCustomerNameSql = sql<string>`lower(regexp_replace(coalesce(${masterlist.customerName}, ''), '[^a-zA-Z0-9]', '', 'g'))`

const getTinPrefix9 = (value: string | null | undefined) => {
  const normalized = normalizeTinDigits(value)
  return normalized.length >= 9 ? normalized.slice(0, 9) : null
}

const normalizeMoneyValue = (raw: unknown): string | null => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw.toFixed(2)
  }

  if (typeof raw === 'string') {
    const parsed = Number(
      raw
        .trim()
        .replace(/[^\d.,-]/gu, '')
        .replace(/,/gu, ''),
    )
    return Number.isFinite(parsed) ? parsed.toFixed(2) : null
  }

  return null
}

const normalizePeriodValue = (raw: unknown): string | null =>
  normalizeTextValue(raw)?.toLowerCase() ?? null

const buildOverrideDataFingerprint = (
  normalized: Record<string, unknown>,
): string | null => {
  const canonical = {
    periodCovered: normalizePeriodValue(normalized.periodCovered),
    periodEnd: normalizePeriodValue(normalized.periodEnd),
    payeeName: normalizeTextValue(normalized.payeeName)?.toLowerCase() ?? null,
    payeeTin: normalizeTinDigits(String(normalized.payeeTin ?? '')) || null,
    payorName: normalizeTextValue(normalized.payorName)?.toLowerCase() ?? null,
    payorTin: normalizeTinDigits(String(normalized.payorTin ?? '')) || null,
    atcCode:
      normalizeTextValue(normalized.atcCode)
        ?.toUpperCase()
        .replace(/[^A-Z0-9]/gu, '') ?? null,
    taxBase: normalizeMoneyValue(normalized.taxBase),
    taxWithheld: normalizeMoneyValue(normalized.taxWithheld),
  }

  if (!Object.values(canonical).some((value) => value !== null)) {
    return null
  }

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

interface UploadMonthRange {
  monthKey: string
  monthStart: Date
  nextMonthStart: Date
}

const getUploadMonthRange = (
  uploadedAt: Date | string | null | undefined,
): UploadMonthRange | null => {
  if (!uploadedAt) {
    return null
  }

  const uploadDate =
    uploadedAt instanceof Date ? uploadedAt : new Date(uploadedAt)
  if (Number.isNaN(uploadDate.getTime())) {
    return null
  }

  const year = uploadDate.getUTCFullYear()
  const month = uploadDate.getUTCMonth()
  const monthStart = new Date(Date.UTC(year, month, 1))
  const nextMonthStart = new Date(Date.UTC(year, month + 1, 1))

  return {
    monthKey: `${year}-${String(month + 1).padStart(2, '0')}`,
    monthStart,
    nextMonthStart,
  }
}

const getNextPayorProcessedNumber = async (
  tx: DbTransaction,
  payorShortName: string | null,
  uploadedAt: Date | string | null | undefined,
) => {
  const uploadMonthRange = getUploadMonthRange(uploadedAt)
  if (!payorShortName || !uploadMonthRange) {
    return 1
  }

  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`processed-number:${payorShortName}:${uploadMonthRange.monthKey}`}))`,
  )

  const rows = await tx
    .select({
      processedCount: sql<number>`count(*)::int`,
    })
    .from(documentResults)
    .innerJoin(intakeFiles, eq(documentResults.uploadId, intakeFiles.id))
    .where(
      and(
        eq(documentResults.payorShortName, payorShortName),
        eq(documentResults.outcome, 'Done'),
        eq(documentResults.status, 'success'),
        sql`${intakeFiles.uploadedAt} >= ${uploadMonthRange.monthStart}`,
        sql`${intakeFiles.uploadedAt} < ${uploadMonthRange.nextMonthStart}`,
      ),
    )

  return Number(rows.at(0)?.processedCount ?? 0) + 1
}

const getPayloadEvent = (payload: unknown) =>
  toNullableRecord(toRecord(payload).event)

const toEntityStorageInput = (
  value: unknown,
): Partial<EntityStorageInput> | null => {
  const record = toNullableRecord(value)
  if (!record) {
    return null
  }

  const id = Number(record.id)
  if (!Number.isInteger(id) || id <= 0) {
    return null
  }

  return {
    id,
    shortName: normalizeTextValue(record.shortName),
  }
}

const getOverrideEntityStorageInput = (
  result: DocumentResultRecord,
  batch: IntakeBatchRecord,
): Partial<EntityStorageInput> | null => {
  const eventEntity = toEntityStorageInput(
    getPayloadEvent(result.payload)?.selectedEntity,
  )
  if (eventEntity) {
    return eventEntity
  }

  if (!batch.entityId) {
    return null
  }

  return {
    id: batch.entityId,
    shortName: batch.entityShortName,
  }
}

const buildS3CopySource = (bucket: string, key: string) =>
  `${encodeURIComponent(bucket)}/${key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`

const buildApprovedArtifactKeys = (input: {
  result: DocumentResultRecord
  file: IntakeFileRecord
  batch: IntakeBatchRecord
  normalized: JsonRecord
  payorShortName: string | null
  processedNumber: number
}) => {
  const entityKey = buildOptionalEntityStorageKey(
    getOverrideEntityStorageInput(input.result, input.batch),
  )
  const customerKey = buildOptionalCustomerStorageKey({
    shortName: input.payorShortName,
  })
  const approvedArtifactKey = buildProcessingArtifactKey({
    prefix: getStoragePrefix(),
    entityKey,
    customerKey,
    batchId: input.batch.id,
    uploadId: input.file.id,
    revision: input.result.revision,
    fileName: 'final-result.json',
  })
  const approvedFinalKey = buildUnsignedCertificateKey({
    prefix: getStoragePrefix(),
    entityKey,
    customerKey,
    period: formatCertificatePeriodKey(
      input.normalized.periodEnd ?? input.normalized.periodCovered,
    ),
    batchId: input.batch.id,
    documentResultId: input.result.id,
    fileName: buildUnsignedCertificateFileName(
      input.result.sourceFileId,
      input.normalized,
      input.processedNumber,
    ),
  })

  return { approvedArtifactKey, approvedFinalKey }
}

const buildApprovedPayload = (input: {
  result: DocumentResultRecord
  normalized: JsonRecord
  overridePatch: JsonRecord
  approvedArtifactKey: string
  approvedFinalKey: string
}) => {
  const originalPayload = toRecord(input.result.payload)
  const originalArtifactKeys = toNullableRecord(originalPayload.artifactKeys)

  return {
    ...originalPayload,
    status: 'success',
    normalized: input.normalized,
    override: input.overridePatch,
    artifactKeys: {
      ...(originalArtifactKeys ?? {}),
      finalResultJson: input.approvedArtifactKey,
      renamedPdf: input.approvedFinalKey,
    },
  }
}

const getPayloadNormalized = (payload: unknown): JsonRecord => {
  const record = toRecord(payload)
  const normalized = toNullableRecord(record.normalized)
  if (normalized) return normalized

  const pages = Array.isArray(record.pages) ? record.pages : []
  const pageWithNormalized = pages.find((page) =>
    isRecord(toRecord(page).normalized),
  )

  return toRecord(toRecord(pageWithNormalized).normalized)
}

const getValidationReasonCodes = (result: DocumentResultRecord) => {
  const validation = toRecord(result.validation)
  const payload = toRecord(result.payload)
  const decision = toRecord(payload.decision)
  const reasons = [
    ...toStringArray(validation.reasons),
    ...toStringArray(result.reasonCodes),
    ...toStringArray(decision.reasonCodes),
  ]

  return Array.from(new Set(reasons))
}

const getValidationPhase = (result: DocumentResultRecord) => {
  const payload = toRecord(result.payload)
  const decision = toRecord(payload.decision)
  const phase = decision.phase
  return typeof phase === 'string' ? phase : null
}

const isInvalidValidation = (result: DocumentResultRecord) => {
  const validation = toRecord(result.validation)
  return (
    validation.status === 'invalid' ||
    getValidationReasonCodes(result).length > 0
  )
}

const hasBlockingOverride = (
  overrides: Array<Pick<OverrideRequestRecord, 'status'>>,
) =>
  overrides.some(
    (request) => request.status === 'pending' || request.status === 'approved',
  )

export const getCertificateOverrideEligibility = (input: {
  result: DocumentResultRecord
  removedFromBatchAt?: Date | null
  existingRequests?: Array<Pick<OverrideRequestRecord, 'status'>>
}) => {
  if (input.result.status !== 'error') {
    return {
      eligible: false,
      reason: 'Only failed validation results can be overridden.',
    }
  }

  if (input.removedFromBatchAt) {
    return {
      eligible: false,
      reason: 'Removed uploads cannot be overridden.',
    }
  }

  if (hasBlockingOverride(input.existingRequests ?? [])) {
    return {
      eligible: false,
      reason:
        'This certificate already has a pending or approved override request.',
    }
  }

  if (getValidationPhase(input.result) !== 'validate') {
    return {
      eligible: false,
      reason: 'Only validation-phase failures can be overridden.',
    }
  }

  if (!isInvalidValidation(input.result)) {
    return {
      eligible: false,
      reason: 'This failure does not contain validation evidence.',
    }
  }

  return { eligible: true, reason: null }
}

const fetchOverrideRequestsForResults = async (
  resultIds: Array<number>,
): Promise<Array<OverrideRequestRecord>> => {
  if (resultIds.length === 0) return []

  return getDb()
    .select()
    .from(certificateOverrideRequests)
    .where(inArray(certificateOverrideRequests.documentResultId, resultIds))
    .orderBy(
      desc(
        sql<number>`case ${certificateOverrideRequests.status} when 'pending' then 3 when 'approved' then 2 else 1 end`,
      ),
      desc(certificateOverrideRequests.createdAt),
    )
}

export const getLatestOverrideRequestByResultId = async (
  resultIds: Array<number>,
) => {
  const requests = await fetchOverrideRequestsForResults(resultIds)
  const byResultId = new Map<number, OverrideRequestRecord>()

  for (const request of requests) {
    if (!byResultId.has(request.documentResultId)) {
      byResultId.set(request.documentResultId, request)
    }
  }

  return byResultId
}

const fetchOverrideRequestByDocumentResultId = async (
  documentResultId: number,
) =>
  getDb()
    .select()
    .from(certificateOverrideRequests)
    .where(eq(certificateOverrideRequests.documentResultId, documentResultId))
    .orderBy(desc(certificateOverrideRequests.createdAt))

const resolveMasterlistMatch = async (input: {
  payorTin: string | null
  payorName: string | null
}) => {
  const tinPrefix = getTinPrefix9(input.payorTin)
  const lookupName = normalizeIdentityName(input.payorName)
  const db = getDb()

  const tinMatches = tinPrefix
    ? await db
        .select()
        .from(masterlist)
        .where(
          sql`regexp_replace(coalesce(${masterlist.tin}, ''), '[^0-9]', '', 'g') LIKE ${`${tinPrefix}%`}`,
        )
        .orderBy(asc(masterlist.shortName), asc(masterlist.customerName))
        .limit(1)
    : []
  const tinMatch = tinMatches.at(0)
  if (tinMatch) {
    return {
      matchMode: 'payorTin',
      shortName: tinMatch.shortName,
      customerName: tinMatch.customerName,
      tin: tinMatch.tin,
      region: tinMatch.region,
      entity: tinMatch.entity,
    }
  }

  if (!lookupName) return null

  const nameMatches = await db
    .select()
    .from(masterlist)
    .where(sql`${compactMasterlistCustomerNameSql} ILIKE ${`%${lookupName}%`}`)
    .orderBy(asc(masterlist.shortName), asc(masterlist.customerName))
    .limit(1)
  const nameMatch = nameMatches.at(0)

  return nameMatch
    ? {
        matchMode: 'payorName',
        shortName: nameMatch.shortName,
        customerName: nameMatch.customerName,
        tin: nameMatch.tin,
        region: nameMatch.region,
        entity: nameMatch.entity,
      }
    : null
}

export const createCertificateOverrideRequest = async (
  input: CreateCertificateOverrideRequestInput,
) => {
  const db = getDb()
  const rows = await db
    .select({
      result: documentResults,
      file: intakeFiles,
      batch: intakeBatches,
    })
    .from(documentResults)
    .innerJoin(intakeFiles, eq(intakeFiles.id, documentResults.uploadId))
    .innerJoin(intakeBatches, eq(intakeBatches.id, documentResults.batchId))
    .where(eq(documentResults.id, input.documentResultId))
    .limit(1)
  const record = rows.at(0)
  if (!record) {
    throw new Error('Certificate result was not found.')
  }

  const existingRequests = await fetchOverrideRequestByDocumentResultId(
    input.documentResultId,
  )
  const eligibility = getCertificateOverrideEligibility({
    result: record.result,
    removedFromBatchAt: record.file.removedFromBatchAt,
    existingRequests,
  })
  if (!eligibility.eligible) {
    throw new Error(
      eligibility.reason ?? 'This certificate cannot be overridden.',
    )
  }

  const inserted = await db
    .insert(certificateOverrideRequests)
    .values({
      documentResultId: record.result.id,
      uploadId: record.file.id,
      batchId: record.batch.id,
      requestedByUserId: input.userId,
      requestNote: input.requestNote,
      originalValidation: toRecord(record.result.validation),
      originalReasonCodes: getValidationReasonCodes(record.result),
    })
    .returning()

  const request = inserted.at(0)
  if (!request) {
    throw new Error('Unable to create override request.')
  }

  return request
}

const toReconciliationNumberValue = (value: unknown): number | null => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/,/gu, ''))
        : Number.NaN

  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null
}

const roundMoney = (value: number) => Number(value.toFixed(2))

const computeDifferences = (input: {
  taxBase: number | null
  taxWithheld: number | null
  taxableSales: number
  prepaidCWT: number
}) => ({
  taxBaseDifference: roundMoney((input.taxBase ?? 0) - input.taxableSales),
  taxWithheldDifference: roundMoney(
    (input.taxWithheld ?? 0) - Math.abs(input.prepaidCWT),
  ),
})

const applyAutomaticReconciliationMatch = async (input: {
  batchId: string
  documentResultId: number
  originalFileName: string
  normalized: JsonRecord
}) => {
  const metadata = parseCertificateFileName(input.originalFileName)
  if (!metadata || metadata.documentType.toUpperCase() !== 'BIR2307') {
    return { matchedCount: 0 }
  }

  const matchInput = {
    issuerShortName: metadata.normalizedIssuerShortname,
    billingMonthMMYY: metadata.billingMonthMMYY,
    taxBase: toReconciliationNumberValue(input.normalized.taxBase),
    taxWithheld: toReconciliationNumberValue(input.normalized.taxWithheld),
  }
  if (!matchInput.issuerShortName) {
    return { matchedCount: 0 }
  }

  const db = getDb()
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: reconciliationResults.id,
        salesReportRunId: reconciliationResults.salesReportRunId,
        taxableSales: reconciliationResults.taxableSales,
        prepaidCWT: reconciliationResults.prepaidCWT,
      })
      .from(reconciliationResults)
      .innerJoin(
        salesReportRunBatches,
        eq(
          reconciliationResults.salesReportRunId,
          salesReportRunBatches.salesReportRunId,
        ),
      )
      .innerJoin(
        salesReportRuns,
        eq(reconciliationResults.salesReportRunId, salesReportRuns.id),
      )
      .where(
        and(
          eq(salesReportRunBatches.batchId, input.batchId),
          isNull(salesReportRuns.archivedAt),
          isNull(reconciliationResults.archivedAt),
          isNotNull(reconciliationResults.salesReportRunId),
          eq(reconciliationResults.matchStatus, 'unmatched'),
          isNull(reconciliationResults.matchedTaxRecordId),
          eq(
            reconciliationResults.issuerShortnameUsedForMatch,
            matchInput.issuerShortName,
          ),
          eq(
            reconciliationResults.derivedBillingMonthMMYY,
            matchInput.billingMonthMMYY,
          ),
        ),
      )
      .orderBy(
        asc(reconciliationResults.salesReportRunId),
        asc(reconciliationResults.id),
      )

    const matchedAt = new Date()
    const updatedRunIds = new Set<string>()
    let matchedCount = 0

    for (const row of rows) {
      if (!row.salesReportRunId) continue

      const difference = computeDifferences({
        taxBase: matchInput.taxBase,
        taxWithheld: matchInput.taxWithheld,
        taxableSales: row.taxableSales,
        prepaidCWT: row.prepaidCWT,
      })
      const updatedRows = await tx
        .update(reconciliationResults)
        .set({
          matchedUploadBatchId: input.batchId,
          matchedTaxRecordId: input.documentResultId,
          taxBase: matchInput.taxBase,
          taxWithheld: matchInput.taxWithheld,
          taxBaseDifference: difference.taxBaseDifference,
          taxWithheldDifference: difference.taxWithheldDifference,
          hasDifference:
            difference.taxBaseDifference !== 0 ||
            difference.taxWithheldDifference !== 0,
          matchStatus: 'matched',
          matchedAt,
          updatedAt: matchedAt,
        })
        .where(
          and(
            eq(reconciliationResults.id, row.id),
            isNull(reconciliationResults.archivedAt),
            eq(reconciliationResults.matchStatus, 'unmatched'),
            isNull(reconciliationResults.matchedTaxRecordId),
          ),
        )
        .returning({
          salesReportRunId: reconciliationResults.salesReportRunId,
        })

      const updated = updatedRows.at(0)
      if (updated?.salesReportRunId) {
        matchedCount += 1
        updatedRunIds.add(updated.salesReportRunId)
      }
    }

    for (const runId of updatedRunIds) {
      const summary = (
        await tx
          .select({
            matchedCount: sql<number>`count(*) filter (where ${reconciliationResults.matchStatus} = 'matched')::int`,
            unmatchedCount: sql<number>`count(*) filter (where ${reconciliationResults.matchStatus} = 'unmatched')::int`,
            varianceTotal: sql<number>`coalesce(sum(abs(${reconciliationResults.taxBaseDifference}) + abs(${reconciliationResults.taxWithheldDifference})), 0)::double precision`,
          })
          .from(reconciliationResults)
          .where(
            and(
              eq(reconciliationResults.salesReportRunId, runId),
              isNull(reconciliationResults.archivedAt),
            ),
          )
      ).at(0)

      await tx
        .update(salesReportRuns)
        .set({
          matchedCount: Number(summary?.matchedCount ?? 0),
          unmatchedCount: Number(summary?.unmatchedCount ?? 0),
          varianceTotal: roundMoney(Number(summary?.varianceTotal ?? 0)),
          updatedAt: matchedAt,
        })
        .where(eq(salesReportRuns.id, runId))
    }

    return { matchedCount }
  })
}

const fetchDecisionRecord = async (requestId: string) => {
  const rows = await getDb()
    .select({
      request: certificateOverrideRequests,
      result: documentResults,
      file: intakeFiles,
      batch: intakeBatches,
    })
    .from(certificateOverrideRequests)
    .innerJoin(
      documentResults,
      eq(documentResults.id, certificateOverrideRequests.documentResultId),
    )
    .innerJoin(
      intakeFiles,
      eq(intakeFiles.id, certificateOverrideRequests.uploadId),
    )
    .innerJoin(
      intakeBatches,
      eq(intakeBatches.id, certificateOverrideRequests.batchId),
    )
    .where(eq(certificateOverrideRequests.id, requestId))
    .limit(1)

  return rows.at(0) ?? null
}

export const approveCertificateOverrideRequest = async (
  input: DecideCertificateOverrideRequestInput,
) => {
  const record = await fetchDecisionRecord(input.requestId)
  if (!record) {
    throw new Error('Override request was not found.')
  }

  if (record.request.status !== 'pending') {
    throw new Error('Only pending override requests can be approved.')
  }

  if (record.request.requestedByUserId === input.userId) {
    throw new Error('You cannot approve your own override request.')
  }

  const normalized = {
    ...getPayloadNormalized(record.result.payload),
  }

  const resolvedMasterlistMatch =
    toNullableRecord(record.request.resolvedMasterlistMatch) ??
    (await resolveMasterlistMatch({
      payorTin: normalizeTextValue(normalized.payorTin),
      payorName: normalizeTextValue(normalized.payorName),
    }))
  const payorShortName = normalizeTextValue(resolvedMasterlistMatch?.shortName)
  const now = new Date()
  const sourceStorageKey = record.file.storageKey.trim()
  if (!sourceStorageKey) {
    throw new Error('No source PDF is available for this override approval.')
  }
  const sourceBucket = record.file.storageBucket.trim()
  if (!sourceBucket) {
    throw new Error(
      'No source PDF bucket is available for this override approval.',
    )
  }
  const destinationBucket = getStorageBucketName()
  const s3 = createS3ServerClient()
  const baseOverridePatch = {
    status: 'approved',
    requestId: record.request.id,
    approvedAt: now.toISOString(),
    approvedByUserId: input.userId,
    requestNote: record.request.requestNote,
    decisionNote: input.decisionNote,
    resolvedMasterlistMatch,
    originalStatus: record.result.status,
    originalOutcome: record.result.outcome,
    originalValidation: record.request.originalValidation,
    originalFinalKey: record.result.finalKey,
    originalArtifactKey: record.result.artifactKey,
  }
  const dataFingerprint = buildOverrideDataFingerprint(normalized)

  await getDb().transaction(async (tx: DbTransaction) => {
    const processedNumber = await getNextPayorProcessedNumber(
      tx,
      payorShortName,
      record.file.uploadedAt,
    )
    const { approvedFinalKey, approvedArtifactKey } = buildApprovedArtifactKeys(
      {
        result: record.result,
        file: record.file,
        batch: record.batch,
        normalized,
        payorShortName,
        processedNumber,
      },
    )
    const overridePatch = {
      ...baseOverridePatch,
      approvedFinalKey,
      approvedArtifactKey,
    }
    const payload = buildApprovedPayload({
      result: record.result,
      normalized,
      overridePatch,
      approvedFinalKey,
      approvedArtifactKey,
    })

    await s3.send(
      new CopyObjectCommand({
        Bucket: destinationBucket,
        Key: approvedFinalKey,
        CopySource: buildS3CopySource(sourceBucket, sourceStorageKey),
      }),
    )

    await s3.send(
      new PutObjectCommand({
        Bucket: destinationBucket,
        Key: approvedArtifactKey,
        Body: JSON.stringify(payload),
        ContentType: 'application/json',
      }),
    )

    await tx
      .update(certificateOverrideRequests)
      .set({
        status: 'approved',
        decisionNote: input.decisionNote,
        decidedByUserId: input.userId,
        decidedAt: now,
        resolvedMasterlistMatch,
        updatedAt: now,
      })
      .where(eq(certificateOverrideRequests.id, record.request.id))

    await tx
      .update(documentResults)
      .set({
        outcome: 'Done',
        status: 'success',
        finalKey: approvedFinalKey,
        payorTin: normalizeTextValue(normalized.payorTin),
        payorName: normalizeTextValue(normalized.payorName),
        payorShortName,
        dataFingerprint,
        payload,
        artifactKey: approvedArtifactKey,
        overrideStatus: 'approved',
        overrideRequestId: record.request.id,
        overriddenAt: now,
        overriddenByUserId: input.userId,
        overridePatch,
      })
      .where(eq(documentResults.id, record.result.id))

    await tx
      .update(intakeFiles)
      .set({
        processingStatus: 'success',
        attentionStatus: 'resolved',
        attentionResolvedAt: now,
        attentionResolvedByUserId: input.userId,
        currentPhase: 'persist',
        currentStep: 'override_approved',
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(intakeFiles.id, record.file.id))

    await tx
      .update(intakeBatches)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(intakeBatches.id, record.batch.id))
  })

  const reconciliation = await applyAutomaticReconciliationMatch({
    batchId: record.batch.id,
    documentResultId: record.result.id,
    originalFileName:
      record.result.originalFileName ?? record.file.originalFileName,
    normalized,
  }).catch(() => ({ matchedCount: 0 }))

  return {
    requestId: record.request.id,
    documentResultId: record.result.id,
    matchedCount: reconciliation.matchedCount,
  }
}

export const rejectCertificateOverrideRequest = async (
  input: DecideCertificateOverrideRequestInput,
) => {
  const record = await fetchDecisionRecord(input.requestId)
  if (!record) {
    throw new Error('Override request was not found.')
  }

  if (record.request.status !== 'pending') {
    throw new Error('Only pending override requests can be rejected.')
  }

  const now = new Date()
  const updated = await getDb()
    .update(certificateOverrideRequests)
    .set({
      status: 'rejected',
      decisionNote: input.decisionNote,
      decidedByUserId: input.userId,
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(certificateOverrideRequests.id, record.request.id))
    .returning()

  return updated.at(0)
}

const buildIssueReason = (result: DocumentResultRecord) => {
  const validation = toRecord(result.validation)
  const reasons = toStringArray(validation.reasons)
  if (reasons.length > 0) return reasons.join(', ')

  const reasonCodes = getValidationReasonCodes(result)
  return reasonCodes.length > 0 ? reasonCodes.join(', ') : 'Validation failed'
}

const toDisplayUser = (
  user: Pick<typeof authUserTable.$inferSelect, 'name' | 'email'> | undefined,
) => user?.name || user?.email || 'Unknown user'

const toRequestView = (input: {
  request: OverrideRequestRecord
  result: DocumentResultRecord
  fileName: string
  entity: string | null
  requester?: typeof authUserTable.$inferSelect
  decider?: typeof authUserTable.$inferSelect
}): CertificateOverrideRequestView => {
  const normalized = getPayloadNormalized(input.result.payload)

  return {
    id: input.request.id,
    documentResultId: input.request.documentResultId,
    uploadId: input.request.uploadId,
    batchId: input.request.batchId,
    status: input.request.status as CertificateOverrideStatus,
    fileName: input.fileName,
    entity: input.entity?.trim() || 'Manual Upload',
    payee: normalizeTextValue(normalized.payeeName) ?? 'Unknown payee',
    payorName: normalizeTextValue(normalized.payorName) ?? 'Unknown payor',
    payorTin: normalizeTextValue(normalized.payorTin) ?? '',
    issueReason: buildIssueReason(input.result),
    requestNote: input.request.requestNote,
    requestedAt: input.request.createdAt.toISOString(),
    requestedByName: toDisplayUser(input.requester),
    requestedByEmail: input.requester?.email ?? null,
    decidedAt: input.request.decidedAt?.toISOString() ?? null,
    decidedByName: input.decider ? toDisplayUser(input.decider) : null,
    decisionNote: input.request.decisionNote,
  }
}

const normalizeOverrideSearch = (value: string | null | undefined) =>
  (value ?? '').trim().slice(0, OVERRIDE_SEARCH_MAX)

const normalizeOverridePage = (value: number | null | undefined) =>
  Number.isFinite(value) && value ? Math.max(1, Math.floor(value)) : 1

const normalizeOverridePageSize = (value: number | null | undefined) => {
  const pageSize =
    Number.isFinite(value) && value ? Math.floor(value) : undefined
  if (!pageSize) return DEFAULT_CERTIFICATE_OVERRIDE_PAGE_SIZE

  return certificateOverridePageSizeOptions.some(
    (option) => option === pageSize,
  )
    ? pageSize
    : DEFAULT_CERTIFICATE_OVERRIDE_PAGE_SIZE
}

const buildOverrideSearchCondition = (query: string): SQL | null => {
  if (!query) return null

  const pattern = `%${escapeLikePattern(query)}%`
  const tinQuery = normalizeTinDigits(query)

  return sql`
    (
      concat_ws(
        ' ',
        ${certificateOverrideRequests.id}::text,
        ${certificateOverrideRequests.documentResultId}::text,
        coalesce(${certificateOverrideRequests.requestNote}, ''),
        coalesce(${certificateOverrideRequests.decisionNote}, ''),
        coalesce(${intakeFiles.originalFileName}, ''),
        coalesce(${intakeBatches.entityShortName}, ''),
        coalesce(${intakeBatches.entityCompanyName}, ''),
        coalesce(${documentResults.payeeName}, ''),
        coalesce(${documentResults.payeeTin}, ''),
        coalesce(${documentResults.payeeShortName}, ''),
        coalesce(${documentResults.payorName}, ''),
        coalesce(${documentResults.payorTin}, ''),
        coalesce(${documentResults.payorShortName}, '')
      ) ilike ${pattern} escape '\\'
      or exists (
        select 1
        from "user" requester
        where requester.id = ${certificateOverrideRequests.requestedByUserId}
          and concat_ws(
            ' ',
            coalesce(requester.name, ''),
            coalesce(requester.email, '')
          ) ilike ${pattern} escape '\\'
      )
      or exists (
        select 1
        from "user" decider
        where decider.id = ${certificateOverrideRequests.decidedByUserId}
          and concat_ws(
            ' ',
            coalesce(decider.name, ''),
            coalesce(decider.email, '')
          ) ilike ${pattern} escape '\\'
      )
      ${
        tinQuery
          ? sql`
            or regexp_replace(
              concat_ws(
                ' ',
                coalesce(${documentResults.payeeTin}, ''),
                coalesce(${documentResults.payorTin}, '')
              ),
              '[^0-9]',
              '',
              'g'
            ) like ${`%${tinQuery}%`}
          `
          : sql``
      }
    )
  `
}

const buildOverrideListCondition = (
  status: CertificateOverrideStatus | 'all',
  query: string,
) => {
  const conditions: Array<SQL> = []
  if (status !== 'all') {
    conditions.push(eq(certificateOverrideRequests.status, status))
  }

  const searchCondition = buildOverrideSearchCondition(query)
  if (searchCondition) {
    conditions.push(searchCondition)
  }

  return conditions.length > 0 ? (and(...conditions) ?? sql`true`) : sql`true`
}

export const listCertificateOverrideRequests = async (
  input: {
    status?: CertificateOverrideStatus | 'all'
    q?: string | null
    page?: number | null
    pageSize?: number | null
  } = {},
): Promise<CertificateOverrideListResult> => {
  const requestedStatus = input.status ?? 'pending'
  const query = normalizeOverrideSearch(input.q)
  const requestedPage = normalizeOverridePage(input.page)
  const pageSize = normalizeOverridePageSize(input.pageSize)
  const filterCondition = buildOverrideListCondition(requestedStatus, query)
  const db = getDb()

  const [summaryRows, totalRows] = await Promise.all([
    db
      .select({
        status: certificateOverrideRequests.status,
        count: sql<number>`count(*)::int`,
      })
      .from(certificateOverrideRequests)
      .groupBy(certificateOverrideRequests.status),
    db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(certificateOverrideRequests)
      .innerJoin(
        documentResults,
        eq(documentResults.id, certificateOverrideRequests.documentResultId),
      )
      .innerJoin(
        intakeFiles,
        eq(intakeFiles.id, certificateOverrideRequests.uploadId),
      )
      .innerJoin(
        intakeBatches,
        eq(intakeBatches.id, certificateOverrideRequests.batchId),
      )
      .where(filterCondition),
  ])
  const totalItems = Number(totalRows.at(0)?.count ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const page = totalItems === 0 ? 1 : Math.min(requestedPage, totalPages)

  const rows = await db
    .select({
      request: certificateOverrideRequests,
      result: documentResults,
      fileName: intakeFiles.originalFileName,
      entityShortName: intakeBatches.entityShortName,
      entityCompanyName: intakeBatches.entityCompanyName,
    })
    .from(certificateOverrideRequests)
    .innerJoin(
      documentResults,
      eq(documentResults.id, certificateOverrideRequests.documentResultId),
    )
    .innerJoin(
      intakeFiles,
      eq(intakeFiles.id, certificateOverrideRequests.uploadId),
    )
    .innerJoin(
      intakeBatches,
      eq(intakeBatches.id, certificateOverrideRequests.batchId),
    )
    .where(filterCondition)
    .orderBy(
      desc(
        sql<number>`case ${certificateOverrideRequests.status} when 'pending' then 3 when 'approved' then 2 else 1 end`,
      ),
      desc(certificateOverrideRequests.createdAt),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const userIds = Array.from(
    new Set(
      rows.flatMap((row) =>
        [row.request.requestedByUserId, row.request.decidedByUserId].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ),
  )
  const users =
    userIds.length === 0
      ? []
      : await db
          .select()
          .from(authUserTable)
          .where(inArray(authUserTable.id, userIds))
  const userById = new Map(users.map((user) => [user.id, user]))

  const summary = {
    pending: 0,
    approved: 0,
    rejected: 0,
  }
  for (const row of summaryRows) {
    if (
      row.status === 'pending' ||
      row.status === 'approved' ||
      row.status === 'rejected'
    ) {
      summary[row.status] = Number(row.count)
    }
  }

  return {
    requests: rows.map((row) =>
      toRequestView({
        request: row.request,
        result: row.result,
        fileName: row.fileName,
        entity: row.entityShortName ?? row.entityCompanyName,
        requester: userById.get(row.request.requestedByUserId),
        decider: row.request.decidedByUserId
          ? userById.get(row.request.decidedByUserId)
          : undefined,
      }),
    ),
    summary,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages && totalItems > 0,
      hasPreviousPage: page > 1 && totalItems > 0,
    },
  }
}
