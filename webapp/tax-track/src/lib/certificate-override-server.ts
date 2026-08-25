import { createHash } from 'node:crypto'

import { normalizeIssuerShortname } from '@taxtrack/shared'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { SQL } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import { applyAutomaticReconciliationAfterCorrection } from '@/lib/reconciliation-auto-match-server'
import {
  atcCodes,
  authUserTable,
  certificateOverrideChanges,
  certificateOverrideRequests,
  certificateResults,
  certificateTaxRows,
  documentResults,
  extractedCertificates,
  intakeBatches,
  intakeFiles,
  masterlist,
} from '@/lib/schema'

type CertificateResultRecord = typeof certificateResults.$inferSelect
type OverrideRequestRecord = typeof certificateOverrideRequests.$inferSelect
type OverrideChangeRecord = typeof certificateOverrideChanges.$inferSelect
type CertificateTaxRowRecord = typeof certificateTaxRows.$inferSelect
type AtcCodeRecord = Pick<typeof atcCodes.$inferSelect, 'code' | 'taxType'>
type DbClient = ReturnType<typeof getDb>
type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0]
type JsonScalar = string | number | boolean | null

export type CertificateOverrideStatus = 'pending' | 'approved' | 'rejected'

export type CertificateOverrideChangeView = {
  fieldPath: string
  originalValue: JsonScalar
  proposedValue: JsonScalar
  status: CertificateOverrideStatus
}

export type CertificateOverrideRequestView = {
  id: string
  certificateId: number
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
  changes: Array<CertificateOverrideChangeView>
  immutableExtractedValues: Record<string, unknown> | null
  effectiveValues: Record<string, unknown>
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
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const TAX_ROW_PATH_PATTERN =
  /^taxRows\.(\d+)\.(atcCode|description|monthlyAmounts\.(?:first|second|third)|taxBase|taxRate|taxWithheld|pageNumber)$/u
const MULTIPLE_CERTIFICATE_REASON_CODES = new Set([
  'multiple_certificates_detected',
  'multiple_certificate_pages_detected',
])

const projectionFieldPaths = new Set([
  'period.start',
  'period.end',
  'period.monthOfQuarter',
  'payee.name',
  'payee.tin',
  'payee.address',
  'payee.zip',
  'payee.shortName',
  'payor.name',
  'payor.tin',
  'payor.address',
  'payor.zip',
  'payor.shortName',
  'primaryAtcCode',
  'totals.taxBase',
  'totals.taxWithheld',
  'signer.printedName',
  'signer.title',
  'signer.tin',
  'signer.companyName',
  'signer.signature.present',
  'signer.signature.confidence',
  'signer.signature.pageNumber',
  'signer.signature.source',
])

const isSupportedFieldPath = (fieldPath: string) =>
  projectionFieldPaths.has(fieldPath) || TAX_ROW_PATH_PATTERN.test(fieldPath)

const jsonScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
])

export const createCertificateOverrideRequestSchema = z.object({
  certificateId: z.number().int().positive(),
  changes: z
    .array(
      z.object({
        fieldPath: z
          .string()
          .trim()
          .min(1)
          .refine(isSupportedFieldPath, 'Unsupported certificate field.'),
        proposedValue: jsonScalarSchema,
      }),
    )
    .min(1, 'At least one field change is required.')
    .max(50, 'A request can contain at most 50 field changes.')
    .superRefine((changes, context) => {
      const seen = new Set<string>()
      changes.forEach((change, index) => {
        if (seen.has(change.fieldPath)) {
          context.addIssue({
            code: 'custom',
            path: [index, 'fieldPath'],
            message: 'Each field may appear only once.',
          })
        }
        seen.add(change.fieldPath)
      })
    }),
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

const normalizeTinDigits = (value: string | null | undefined) =>
  (value ?? '').replace(/\D/gu, '')

const escapeLikePattern = (value: string) => value.replaceAll(/[%_\\]/g, '\\$&')

const requireString = (
  value: JsonScalar,
  fieldPath: string,
  nullable = false,
) => {
  if (value === null && nullable) return null
  if (typeof value !== 'string') {
    throw new Error(`${fieldPath} must be a string.`)
  }
  const result = value.trim()
  if (!nullable && result.length === 0) {
    throw new Error(`${fieldPath} cannot be empty.`)
  }
  return result.length > 0 ? result : null
}

const requireDecimal = (value: JsonScalar, fieldPath: string) => {
  const result = requireString(value, fieldPath)
  if (!result || !DECIMAL_PATTERN.test(result)) {
    throw new Error(`${fieldPath} must be a decimal string.`)
  }
  return result
}

const requireDate = (value: JsonScalar, fieldPath: string) => {
  const result = requireString(value, fieldPath)
  if (!result || !ISO_DATE_PATTERN.test(result)) {
    throw new Error(`${fieldPath} must use YYYY-MM-DD.`)
  }
  const parsed = new Date(`${result}T00:00:00.000Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== result
  ) {
    throw new Error(`${fieldPath} must be a valid date.`)
  }
  return result
}

const requirePositiveInteger = (
  value: JsonScalar,
  fieldPath: string,
  nullable = false,
) => {
  if (value === null && nullable) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldPath} must be a positive integer.`)
  }
  return value
}

const toEffectiveValues = (result: CertificateResultRecord) => {
  return {
    certificateKey: result.certificateKey,
    pageNumbers: result.pageNumbers,
    period: {
      start: result.periodStart,
      end: result.periodEnd,
      monthOfQuarter: result.monthOfQuarter,
    },
    payee: {
      name: result.payeeName,
      tin: result.payeeTin,
      address: result.payeeAddress,
      zip: result.payeeZip,
      shortName: result.payeeShortName,
    },
    payor: {
      name: result.payorName,
      tin: result.payorTin,
      address: result.payorAddress,
      zip: result.payorZip,
      shortName: result.payorShortName,
    },
    primaryAtcCode: result.primaryAtcCode,
    totals: {
      taxBase: result.totalTaxBase,
      taxWithheld: result.totalTaxWithheld,
    },
    signer: {
      printedName: result.signerPrintedName,
      title: result.signerTitle,
      tin: result.signerTin,
      companyName: result.signerCompanyName,
      signature: {
        present: result.signaturePresent,
        confidence: Number(result.signatureConfidence),
        pageNumber: result.signaturePageNumber,
        source: result.signatureSource,
      },
    },
  }
}

const getProjectionValue = (
  result: CertificateResultRecord,
  fieldPath: string,
): JsonScalar => {
  const values = toEffectiveValues(result)
  const path = fieldPath.split('.')
  let current: unknown = values
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) return null
    current = (current as Record<string, unknown>)[segment]
  }
  return (
    typeof current === 'string' ||
    typeof current === 'number' ||
    typeof current === 'boolean' ||
    current === null
      ? current
      : null
  ) as JsonScalar
}

const getTaxRowValue = (
  taxRows: Array<CertificateTaxRowRecord>,
  fieldPath: string,
): JsonScalar => {
  const match = fieldPath.match(TAX_ROW_PATH_PATTERN)
  if (!match) return null
  const lineNumber = Number(match[1])
  const field = match[2]
  const row = taxRows.find((candidate) => candidate.lineNumber === lineNumber)
  if (!row) {
    throw new Error(`Tax row ${lineNumber} was not found.`)
  }
  const fieldMap: Record<string, keyof CertificateTaxRowRecord> = {
    atcCode: 'atcCode',
    description: 'description',
    'monthlyAmounts.first': 'firstMonthAmount',
    'monthlyAmounts.second': 'secondMonthAmount',
    'monthlyAmounts.third': 'thirdMonthAmount',
    taxBase: 'taxBase',
    taxRate: 'taxRate',
    taxWithheld: 'taxWithheld',
    pageNumber: 'pageNumber',
  }
  const value = row[fieldMap[field]]
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
      ? value
      : null
  ) as JsonScalar
}

const normalizeProposedValue = (
  fieldPath: string,
  value: JsonScalar,
): JsonScalar => {
  if (fieldPath === 'period.start' || fieldPath === 'period.end') {
    return requireDate(value, fieldPath)
  }
  if (fieldPath === 'period.monthOfQuarter') {
    const result = requireString(value, fieldPath)
    if (!['first', 'second', 'third'].includes(result ?? '')) {
      throw new Error(`${fieldPath} must be first, second, or third.`)
    }
    return result
  }
  if (
    fieldPath === 'totals.taxBase' ||
    fieldPath === 'totals.taxWithheld' ||
    /\.(taxBase|taxRate|taxWithheld)$/u.test(fieldPath) ||
    /\.monthlyAmounts\.(first|second|third)$/u.test(fieldPath)
  ) {
    return value === null &&
      /\.monthlyAmounts\.(first|second|third)$/u.test(fieldPath)
      ? null
      : requireDecimal(value, fieldPath)
  }
  if (fieldPath === 'signer.signature.present') {
    if (typeof value !== 'boolean') {
      throw new Error(`${fieldPath} must be a boolean.`)
    }
    return value
  }
  if (fieldPath === 'signer.signature.confidence') {
    if (typeof value !== 'number' || value < 0 || value > 1) {
      throw new Error(`${fieldPath} must be a number from 0 to 1.`)
    }
    return value
  }
  if (
    fieldPath === 'signer.signature.pageNumber' ||
    /\.pageNumber$/u.test(fieldPath)
  ) {
    return requirePositiveInteger(value, fieldPath, true)
  }
  if (fieldPath === 'signer.signature.source') {
    const result = requireString(value, fieldPath)
    if (
      !['gemini', 'visual_fallback', 'human_override'].includes(result ?? '')
    ) {
      throw new Error(`${fieldPath} has an invalid source.`)
    }
    return result
  }
  const nullable =
    /\.(address|zip|shortName)$/u.test(fieldPath) ||
    /^signer\.(printedName|title|tin|companyName)$/u.test(fieldPath) ||
    /\.description$/u.test(fieldPath)
  return requireString(value, fieldPath, nullable)
}

const projectionPatchForChange = (
  fieldPath: string,
  value: JsonScalar,
): Partial<typeof extractedCertificates.$inferInsert> => {
  switch (fieldPath) {
    case 'period.start':
      return { periodStart: String(value) }
    case 'period.end':
      return { periodEnd: String(value) }
    case 'period.monthOfQuarter':
      return { monthOfQuarter: String(value) }
    case 'payee.name':
      return { payeeName: String(value) }
    case 'payee.tin':
      return { payeeTin: String(value) }
    case 'payee.address':
      return { payeeAddress: value as string | null }
    case 'payee.zip':
      return { payeeZip: value as string | null }
    case 'payee.shortName':
      return { payeeShortName: value as string | null }
    case 'payor.name':
      return { payorName: String(value) }
    case 'payor.tin':
      return { payorTin: String(value) }
    case 'payor.address':
      return { payorAddress: value as string | null }
    case 'payor.zip':
      return { payorZip: value as string | null }
    case 'payor.shortName':
      return { payorShortName: value as string | null }
    case 'primaryAtcCode':
      return { primaryAtcCode: normalizeAtcCode(value) }
    case 'totals.taxBase':
      return { totalTaxBase: String(value) }
    case 'totals.taxWithheld':
      return { totalTaxWithheld: String(value) }
    case 'signer.printedName':
      return { signerPrintedName: value as string | null }
    case 'signer.title':
      return { signerTitle: value as string | null }
    case 'signer.tin':
      return { signerTin: value as string | null }
    case 'signer.companyName':
      return { signerCompanyName: value as string | null }
    case 'signer.signature.present':
      return { signaturePresent: Boolean(value) }
    case 'signer.signature.confidence':
      return { signatureConfidence: String(value) }
    case 'signer.signature.pageNumber':
      return { signaturePageNumber: value as number | null }
    case 'signer.signature.source':
      return { signatureSource: String(value) }
    default:
      return {}
  }
}

const taxRowPatchForChange = (
  fieldPath: string,
  value: JsonScalar,
): {
  lineNumber: number
  patch: Partial<typeof certificateTaxRows.$inferInsert>
} | null => {
  const match = fieldPath.match(TAX_ROW_PATH_PATTERN)
  if (!match) return null
  const lineNumber = Number(match[1])
  const patchByField: Record<
    string,
    Partial<typeof certificateTaxRows.$inferInsert>
  > = {
    atcCode: { atcCode: normalizeAtcCode(value) },
    description: { description: value as string | null },
    'monthlyAmounts.first': {
      firstMonthAmount: value as string | null,
    },
    'monthlyAmounts.second': {
      secondMonthAmount: value as string | null,
    },
    'monthlyAmounts.third': {
      thirdMonthAmount: value as string | null,
    },
    taxBase: { taxBase: String(value) },
    taxRate: { taxRate: String(value) },
    taxWithheld: { taxWithheld: String(value) },
    pageNumber: { pageNumber: value as number },
  }
  return { lineNumber, patch: patchByField[match[2]] ?? {} }
}

const fetchCertificate = async (certificateId: number) => {
  const rows = await getDb()
    .select()
    .from(certificateResults)
    .where(eq(certificateResults.id, certificateId))
    .limit(1)
  return rows.at(0) ?? null
}

export const getCertificateOverrideEligibility = (input: {
  result: CertificateResultRecord
  removedFromBatchAt?: Date | null
  existingRequests?: Array<Pick<OverrideRequestRecord, 'status'>>
}) => {
  if (
    input.result.reasonCodes.some((reason) =>
      MULTIPLE_CERTIFICATE_REASON_CODES.has(reason),
    )
  ) {
    return {
      eligible: false,
      reason:
        'This file contains multiple certificates. Upload each certificate as a separate PDF to make corrections.',
    }
  }
  if (
    input.result.status !== 'accepted' &&
    input.result.status !== 'manual_review' &&
    input.result.status !== 'error'
  ) {
    return {
      eligible: false,
      reason: 'Only extracted certificates can be corrected.',
    }
  }
  if (input.removedFromBatchAt) {
    return {
      eligible: false,
      reason: 'Removed uploads cannot be corrected.',
    }
  }
  if (input.existingRequests?.some((request) => request.status === 'pending')) {
    return {
      eligible: false,
      reason: 'This certificate already has a pending correction request.',
    }
  }
  return { eligible: true, reason: null }
}

export const getLatestOverrideRequestByResultId = async (
  certificateIds: Array<number>,
) => {
  if (certificateIds.length === 0) {
    return new Map<number, OverrideRequestRecord>()
  }
  const requests = await getDb()
    .select()
    .from(certificateOverrideRequests)
    .where(inArray(certificateOverrideRequests.certificateId, certificateIds))
    .orderBy(desc(certificateOverrideRequests.createdAt))
  const byCertificateId = new Map<number, OverrideRequestRecord>()
  requests.forEach((request) => {
    if (!byCertificateId.has(request.certificateId)) {
      byCertificateId.set(request.certificateId, request)
    }
  })
  return byCertificateId
}

export const createCertificateOverrideRequest = async (
  input: CreateCertificateOverrideRequestInput,
) => {
  const parsed = createCertificateOverrideRequestSchema.parse(input)
  const db = getDb()
  const [result, fileRows, existingRequests, taxRows] = await Promise.all([
    fetchCertificate(parsed.certificateId),
    db
      .select()
      .from(intakeFiles)
      .where(
        eq(
          intakeFiles.id,
          sql`(select upload_id from document_results where id = (select document_result_id from extracted_certificates where id = ${parsed.certificateId}))`,
        ),
      )
      .limit(1),
    db
      .select()
      .from(certificateOverrideRequests)
      .where(
        eq(certificateOverrideRequests.certificateId, parsed.certificateId),
      ),
    db
      .select()
      .from(certificateTaxRows)
      .where(eq(certificateTaxRows.certificateId, parsed.certificateId)),
  ])
  if (!result) throw new Error('Certificate was not found.')
  const file = fileRows.at(0)
  if (!file) throw new Error('Certificate upload was not found.')
  if (file.purgeStatus) {
    throw new Error(
      'Certificates queued for permanent deletion cannot be corrected.',
    )
  }

  const eligibility = getCertificateOverrideEligibility({
    result,
    removedFromBatchAt: file.removedFromBatchAt,
    existingRequests,
  })
  if (!eligibility.eligible) {
    throw new Error(
      eligibility.reason ?? 'This certificate cannot be corrected.',
    )
  }

  const changes = parsed.changes.map((change) => {
    const proposedValue = normalizeProposedValue(
      change.fieldPath,
      change.proposedValue,
    )
    const originalValue = TAX_ROW_PATH_PATTERN.test(change.fieldPath)
      ? getTaxRowValue(taxRows, change.fieldPath)
      : getProjectionValue(result, change.fieldPath)
    if (JSON.stringify(originalValue) === JSON.stringify(proposedValue)) {
      throw new Error(`${change.fieldPath} does not change the current value.`)
    }
    return { ...change, originalValue, proposedValue }
  })

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(certificateOverrideRequests)
      .values({
        certificateId: result.id,
        requestedByUserId: input.userId,
        requestNote: parsed.requestNote,
      })
      .returning()
    const request = inserted.at(0)
    if (!request) throw new Error('Unable to create correction request.')

    await tx.insert(certificateOverrideChanges).values(
      changes.map((change) => ({
        requestId: request.id,
        fieldPath: change.fieldPath,
        originalValue: change.originalValue,
        proposedValue: change.proposedValue,
        requestedByUserId: input.userId,
        requestNote: parsed.requestNote,
      })),
    )
    return {
      ...request,
      batchId: result.batchId,
      uploadId: result.uploadId,
      changes,
    }
  })
}

const fetchDecisionRecord = async (requestId: string) => {
  const requestRows = await getDb()
    .select()
    .from(certificateOverrideRequests)
    .where(eq(certificateOverrideRequests.id, requestId))
    .limit(1)
  const request = requestRows.at(0)
  if (!request) return null
  const [result, changes, taxRows] = await Promise.all([
    fetchCertificate(request.certificateId),
    getDb()
      .select()
      .from(certificateOverrideChanges)
      .where(eq(certificateOverrideChanges.requestId, requestId)),
    getDb()
      .select()
      .from(certificateTaxRows)
      .where(eq(certificateTaxRows.certificateId, request.certificateId)),
  ])
  return result ? { request, result, changes, taxRows } : null
}

const stableFingerprint = (
  result: CertificateResultRecord,
  projectionPatch: Partial<typeof extractedCertificates.$inferInsert>,
  taxRows: Array<CertificateTaxRowRecord>,
  taxRowPatches: Map<number, Partial<typeof certificateTaxRows.$inferInsert>>,
) => {
  const effectiveResult = {
    ...result,
    ...projectionPatch,
  } as CertificateResultRecord
  return createHash('sha256')
    .update(
      JSON.stringify({
        projection: toEffectiveValues(effectiveResult),
        taxRows: taxRows.map((row) => ({
          ...row,
          ...(taxRowPatches.get(row.lineNumber) ?? {}),
        })),
      }),
    )
    .digest('hex')
}

const normalizeAtcCode = (value: unknown) =>
  typeof value === 'string'
    ? value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/gu, '')
    : ''

const toFiniteDecimal = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const deriveTaxRowProjection = (
  taxRows: Array<CertificateTaxRowRecord>,
  taxRowPatches: Map<number, Partial<typeof certificateTaxRows.$inferInsert>>,
  rules: Array<AtcCodeRecord>,
  preferredPrimaryAtcCode?: string | null,
) => {
  const taxTypeByCode = new Map(
    rules.map((rule) => [
      normalizeAtcCode(rule.code),
      rule.taxType.trim().toUpperCase(),
    ]),
  )
  const finalRows = taxRows
    .map((row) => ({
      ...row,
      ...(taxRowPatches.get(row.lineNumber) ?? {}),
    }))
    .sort(
      (left, right) =>
        left.pageNumber - right.pageNumber ||
        left.lineNumber - right.lineNumber,
    )
  const populatedRows = finalRows.filter((row) =>
    Boolean(normalizeAtcCode(row.atcCode)),
  )
  const weRows = populatedRows.filter(
    (row) => taxTypeByCode.get(normalizeAtcCode(row.atcCode)) === 'WE',
  )
  const primaryAtcCode =
    preferredPrimaryAtcCode !== undefined
      ? normalizeAtcCode(preferredPrimaryAtcCode) || null
      : normalizeAtcCode((weRows.at(0) ?? populatedRows.at(0))?.atcCode) || null
  const primaryRows = primaryAtcCode
    ? populatedRows.filter(
        (row) => normalizeAtcCode(row.atcCode) === primaryAtcCode,
      )
    : []
  const sumCompleteField = (
    field: 'taxBase' | 'taxWithheld',
  ): string | null => {
    if (primaryRows.length === 0) return null
    const amounts = primaryRows.map((row) => toFiniteDecimal(row[field]))
    if (!amounts.every((amount): amount is number => amount !== null)) {
      return null
    }
    return amounts.reduce((total, amount) => total + amount, 0).toFixed(2)
  }

  return {
    primaryAtcCode,
    totalTaxBase: sumCompleteField('taxBase'),
    totalTaxWithheld: sumCompleteField('taxWithheld'),
  }
}

const IDENTITY_FIELD_PATHS = [
  'payee.name',
  'payee.tin',
  'payor.name',
  'payor.tin',
] as const

type IdentityFieldPath = (typeof IDENTITY_FIELD_PATHS)[number]

const DETERMINISTIC_IDENTITY_REASON_CODES = new Set([
  'missing_payee_name',
  'missing_payee_tin',
  'missing_payor_name',
  'missing_payor_tin',
  'entity_payee_name_mismatch',
  'entity_payee_tin_mismatch',
  'payor_name_not_found_in_masterlist',
  'payor_tin_not_found_in_masterlist',
  'masterlist_payor_identity_mismatch',
  'masterlist_lookup_failed',
])

const IDENTITY_CHECK_CODES = new Set([
  'PAYEE_NAME_PRESENT',
  'PAYEE_TIN_PRESENT',
  'PAYOR_NAME_PRESENT',
  'PAYOR_TIN_PRESENT',
  'ENTITY_PAYEE_NAME_MATCH',
  'ENTITY_PAYEE_TIN_MATCH',
  'MASTERLIST_PAYOR_NAME_MATCH',
  'MASTERLIST_PAYOR_TIN_MATCH',
  'MASTERLIST_PAYOR_IDENTITY_MATCH',
])

const normalizeIdentityName = (value: string | null | undefined) => {
  const normalized = (value ?? '')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => (token === 'corporation' ? 'corp' : token))
    .join('')
  return normalized || null
}

const tinPrefix9 = (value: string | null | undefined) =>
  normalizeTinDigits(value).slice(0, 9)

const identityReviewReason = (fieldPath: IdentityFieldPath) =>
  `ai_cannot_read_${fieldPath.replace('.', '_')}`

const identityRereadFailureReason = (fieldPath: IdentityFieldPath) =>
  `identity_reread_failed_${fieldPath.replace('.', '_')}`

const isIdentityFieldPath = (value: string): value is IdentityFieldPath =>
  IDENTITY_FIELD_PATHS.includes(value as IdentityFieldPath)

type RevalidationCheck = {
  code: string
  passed: boolean | null
  message: string
}

const revalidateCorrectedIdentity = async (input: {
  result: CertificateResultRecord
  projectionPatch: Partial<typeof extractedCertificates.$inferInsert>
  correctedFieldPaths: Set<IdentityFieldPath>
}) => {
  const effective = {
    ...input.result,
    ...input.projectionPatch,
  } as CertificateResultRecord
  const [batchRows, masterlistRows] = await Promise.all([
    getDb()
      .select()
      .from(intakeBatches)
      .where(eq(intakeBatches.id, input.result.batchId))
      .limit(1),
    getDb().select().from(masterlist),
  ])
  const batch = batchRows.at(0)
  const unresolved = new Set<IdentityFieldPath>()
  const retainedReasons = input.result.reasonCodes.filter((reason) => {
    if (DETERMINISTIC_IDENTITY_REASON_CODES.has(reason)) return false
    for (const fieldPath of IDENTITY_FIELD_PATHS) {
      if (
        input.correctedFieldPaths.has(fieldPath) &&
        (reason === identityReviewReason(fieldPath) ||
          reason === identityRereadFailureReason(fieldPath))
      ) {
        return false
      }
      if (reason === identityReviewReason(fieldPath)) {
        unresolved.add(fieldPath)
      }
    }
    return true
  })
  const existingValidation =
    input.result.validationSummary &&
    typeof input.result.validationSummary === 'object'
      ? input.result.validationSummary
      : {}
  const existingChecks = Array.isArray(existingValidation.checks)
    ? existingValidation.checks.filter((value): value is RevalidationCheck => {
        if (!value || typeof value !== 'object') return false
        const code = (value as { code?: unknown }).code
        return typeof code === 'string' && !IDENTITY_CHECK_CODES.has(code)
      })
    : []
  const reasons = [...retainedReasons]
  const checks: Array<RevalidationCheck> = [...existingChecks]
  const addCheck = (input: {
    fieldPath?: IdentityFieldPath
    code: string
    passed: boolean
    success: string
    failure: string
    reason: string
  }) => {
    if (input.fieldPath && unresolved.has(input.fieldPath)) {
      checks.push({
        code: input.code,
        passed: null,
        message: `${input.fieldPath} remains unresolved and requires manual review.`,
      })
      return
    }
    checks.push({
      code: input.code,
      passed: input.passed,
      message: input.passed ? input.success : input.failure,
    })
    if (!input.passed) reasons.push(input.reason)
  }

  const values = [
    ['payee.name', effective.payeeName, 'PAYEE_NAME_PRESENT', 'missing_payee_name'],
    ['payee.tin', effective.payeeTin, 'PAYEE_TIN_PRESENT', 'missing_payee_tin'],
    ['payor.name', effective.payorName, 'PAYOR_NAME_PRESENT', 'missing_payor_name'],
    ['payor.tin', effective.payorTin, 'PAYOR_TIN_PRESENT', 'missing_payor_tin'],
  ] as const
  for (const [fieldPath, value, code, reason] of values) {
    addCheck({
      fieldPath,
      code,
      passed: Boolean(value?.trim()),
      success: `${fieldPath} is present.`,
      failure: `${fieldPath} is missing.`,
      reason,
    })
  }

  const selectedTin = tinPrefix9(batch?.entityTin)
  const payeeTin = tinPrefix9(effective.payeeTin)
  const payeeTinMatches =
    selectedTin.length === 9 && payeeTin.length === 9 && payeeTin === selectedTin
  addCheck({
    fieldPath: 'payee.tin',
    code: 'ENTITY_PAYEE_TIN_MATCH',
    passed: payeeTinMatches,
    success: 'Payee TIN matches the selected entity.',
    failure: 'Payee TIN does not match the selected entity.',
    reason: 'entity_payee_tin_mismatch',
  })

  const selectedName = normalizeIdentityName(batch?.entityCompanyName)
  const payeeName = normalizeIdentityName(effective.payeeName)
  const payeeNameMatches = Boolean(
    selectedName && payeeName && selectedName.includes(payeeName),
  )
  addCheck({
    fieldPath: 'payee.name',
    code: 'ENTITY_PAYEE_NAME_MATCH',
    passed: payeeNameMatches,
    success: 'Payee name matches the selected entity.',
    failure: 'Payee name does not match the selected entity.',
    reason: 'entity_payee_name_mismatch',
  })

  const payorTin = tinPrefix9(effective.payorTin)
  const payorName = normalizeIdentityName(effective.payorName)
  const tinMatches =
    payorTin.length === 9
      ? masterlistRows.filter((row) =>
          normalizeTinDigits(row.tin).startsWith(payorTin),
        )
      : []
  const nameMatches = payorName
    ? masterlistRows.filter((row) =>
        normalizeIdentityName(row.customerName)?.includes(payorName),
      )
    : []
  addCheck({
    fieldPath: 'payor.tin',
    code: 'MASTERLIST_PAYOR_TIN_MATCH',
    passed: tinMatches.length > 0,
    success: 'Payor TIN matches the masterlist.',
    failure: 'Payor TIN was not found in the masterlist.',
    reason: 'payor_tin_not_found_in_masterlist',
  })
  addCheck({
    fieldPath: 'payor.name',
    code: 'MASTERLIST_PAYOR_NAME_MATCH',
    passed: nameMatches.length > 0,
    success: 'Payor name matches the masterlist.',
    failure: 'Payor name was not found in the masterlist.',
    reason: 'payor_name_not_found_in_masterlist',
  })
  const nameMatchIds = new Set(nameMatches.map((row) => row.id))
  const identityMatches = tinMatches.filter((row) => nameMatchIds.has(row.id))
  if (
    !unresolved.has('payor.tin') &&
    !unresolved.has('payor.name') &&
    tinMatches.length > 0 &&
    nameMatches.length > 0
  ) {
    addCheck({
      code: 'MASTERLIST_PAYOR_IDENTITY_MATCH',
      passed: identityMatches.length > 0,
      success: 'Payor name and TIN match the same masterlist record.',
      failure: 'Payor name and TIN match different masterlist records.',
      reason: 'masterlist_payor_identity_mismatch',
    })
  }

  const uniqueReasons = Array.from(new Set(reasons))
  const manualReviewReasons = uniqueReasons.filter(
    (reason) =>
      reason.startsWith('ai_cannot_read_') ||
      reason.startsWith('identity_reread_failed_'),
  )
  const hardReasons = uniqueReasons.filter(
    (reason) => !manualReviewReasons.includes(reason),
  )
  const validationStatus =
    hardReasons.length > 0
      ? ('invalid' as const)
      : manualReviewReasons.length > 0
        ? ('manual_review' as const)
        : ('valid' as const)
  const matchedMasterlist = identityMatches.at(0)

  return {
    reasonCodes: uniqueReasons,
    validationStatus,
    validationSummary: {
      ...existingValidation,
      status: validationStatus,
      reasons: uniqueReasons,
      checks,
    },
    masterlistResolution: {
      status:
        unresolved.has('payor.name') || unresolved.has('payor.tin')
          ? 'skipped'
          : matchedMasterlist
            ? 'matched'
            : 'not_found',
      payorName: effective.payorName,
      payorTin: effective.payorTin,
      matchCount: identityMatches.length,
      matches: identityMatches,
      tinLookup: {
        status: tinMatches.length > 0 ? 'matched' : 'not_found',
        matchCount: tinMatches.length,
        matches: tinMatches,
      },
      nameLookup: {
        status: nameMatches.length > 0 ? 'matched' : 'not_found',
        matchCount: nameMatches.length,
        matches: nameMatches,
      },
    },
    payeeShortName:
      payeeTinMatches && payeeNameMatches ? (batch?.entityShortName ?? null) : null,
    payorShortName: matchedMasterlist?.shortName ?? null,
    masterlistMatchCount: identityMatches.length,
  }
}

const aggregateDocumentStatus = (
  certificates: Array<{ status: string; reasonCodes: Array<string> }>,
) => {
  const status = certificates.some((certificate) => certificate.status === 'error')
    ? 'error'
    : certificates.some((certificate) => certificate.status === 'manual_review')
      ? 'manual_review'
      : certificates.every((certificate) => certificate.status === 'duplicate')
        ? 'duplicate'
        : 'accepted'
  return {
    status,
    reasonCodes: Array.from(
      new Set(certificates.flatMap((certificate) => certificate.reasonCodes)),
    ),
  }
}

const deriveBillingMonthMMYY = (
  periodEnd: string | null,
  monthOfQuarter: string | null,
) => {
  if (!periodEnd || !/^\d{4}-\d{2}-\d{2}$/u.test(periodEnd)) return null
  const year = Number(periodEnd.slice(0, 4))
  const periodEndMonth = Number(periodEnd.slice(5, 7)) - 1
  const offset =
    monthOfQuarter === 'first'
      ? 0
      : monthOfQuarter === 'second'
        ? 1
        : monthOfQuarter === 'third'
          ? 2
          : null
  const month =
    offset === null ? periodEndMonth : Math.floor(periodEndMonth / 3) * 3 + offset
  return Number.isInteger(year) && month >= 0 && month <= 11
    ? `${String(month + 1).padStart(2, '0')}${String(year).slice(-2)}`
    : null
}

export const approveCertificateOverrideRequest = async (
  input: DecideCertificateOverrideRequestInput,
) => {
  const record = await fetchDecisionRecord(input.requestId)
  if (!record) throw new Error('Correction request was not found.')
  if (record.request.status !== 'pending') {
    throw new Error('Only pending correction requests can be approved.')
  }
  if (record.request.requestedByUserId === input.userId) {
    throw new Error('You cannot approve your own correction request.')
  }

  const projectionPatch: Partial<typeof extractedCertificates.$inferInsert> = {}
  const taxRowPatches = new Map<
    number,
    Partial<typeof certificateTaxRows.$inferInsert>
  >()
  record.changes.forEach((change) => {
    const proposedValue = change.proposedValue as JsonScalar
    Object.assign(
      projectionPatch,
      projectionPatchForChange(change.fieldPath, proposedValue),
    )
    const taxRowChange = taxRowPatchForChange(change.fieldPath, proposedValue)
    if (taxRowChange) {
      taxRowPatches.set(taxRowChange.lineNumber, {
        ...(taxRowPatches.get(taxRowChange.lineNumber) ?? {}),
        ...taxRowChange.patch,
      })
    }
  })
  const explicitlyOverridesPrimaryAtc = record.changes.some(
    (change) => change.fieldPath === 'primaryAtcCode',
  )
  const explicitlyOverridesTaxBase = record.changes.some(
    (change) => change.fieldPath === 'totals.taxBase',
  )
  const explicitlyOverridesTaxWithheld = record.changes.some(
    (change) => change.fieldPath === 'totals.taxWithheld',
  )
  if (taxRowPatches.size > 0 || explicitlyOverridesPrimaryAtc) {
    const rules = await getDb()
      .select({ code: atcCodes.code, taxType: atcCodes.taxType })
      .from(atcCodes)
      .where(sql`true`)
    const derivedProjection = deriveTaxRowProjection(
      record.taxRows,
      taxRowPatches,
      rules,
      explicitlyOverridesPrimaryAtc
        ? (projectionPatch.primaryAtcCode as string | null | undefined)
        : undefined,
    )

    if (!explicitlyOverridesPrimaryAtc) {
      projectionPatch.primaryAtcCode = derivedProjection.primaryAtcCode
    }
    if (!explicitlyOverridesTaxBase) {
      projectionPatch.totalTaxBase = derivedProjection.totalTaxBase
    }
    if (!explicitlyOverridesTaxWithheld) {
      projectionPatch.totalTaxWithheld = derivedProjection.totalTaxWithheld
    }
  }

  const correctedIdentityPaths = new Set<IdentityFieldPath>(
    record.changes
      .map((change) => change.fieldPath)
      .filter(isIdentityFieldPath),
  )
  const shouldRevalidateIdentity =
    record.result.status === 'manual_review' || correctedIdentityPaths.size > 0
  const identityRevalidation = shouldRevalidateIdentity
    ? await revalidateCorrectedIdentity({
        result: record.result,
        projectionPatch,
        correctedFieldPaths: correctedIdentityPaths,
      })
    : null
  if (identityRevalidation) {
    projectionPatch.payeeShortName = identityRevalidation.payeeShortName
    projectionPatch.payorShortName = identityRevalidation.payorShortName
  }

  const now = new Date()
  const fingerprint = stableFingerprint(
    record.result,
    projectionPatch,
    record.taxRows,
    taxRowPatches,
  )
  let resolvedStatus = record.result.status
  let resolvedReasonCodes = record.result.reasonCodes
  await getDb().transaction(async (tx: DbTransaction) => {
    if (identityRevalidation) {
      if (identityRevalidation.validationStatus === 'invalid') {
        resolvedStatus = 'error'
      } else if (identityRevalidation.validationStatus === 'manual_review') {
        resolvedStatus = 'manual_review'
      } else {
        const duplicate = await tx
          .select({ id: extractedCertificates.id })
          .from(extractedCertificates)
          .where(
            and(
              eq(extractedCertificates.fingerprint, fingerprint),
              eq(extractedCertificates.status, 'accepted'),
              ne(extractedCertificates.id, record.result.id),
            ),
          )
          .limit(1)
        resolvedStatus = duplicate.length > 0 ? 'duplicate' : 'accepted'
      }
      resolvedReasonCodes = Array.from(
        new Set([
          ...identityRevalidation.reasonCodes.filter(
            (reason) => reason !== 'duplicate_certificate',
          ),
          ...(resolvedStatus === 'duplicate' ? ['duplicate_certificate'] : []),
        ]),
      )
    }

    await tx
      .update(extractedCertificates)
      .set({
        ...projectionPatch,
        fingerprint,
        ...(identityRevalidation
          ? {
              status: resolvedStatus,
              validationStatus: identityRevalidation.validationStatus,
              reasonCodes: resolvedReasonCodes,
              validationSummary: identityRevalidation.validationSummary,
              masterlistResolution: identityRevalidation.masterlistResolution,
            }
          : {}),
        updatedAt: now,
      })
      .where(eq(extractedCertificates.id, record.result.id))
    for (const [lineNumber, patch] of taxRowPatches) {
      await tx
        .update(certificateTaxRows)
        .set({ ...patch, updatedAt: now })
        .where(
          and(
            eq(certificateTaxRows.certificateId, record.result.id),
            eq(certificateTaxRows.lineNumber, lineNumber),
          ),
        )
    }
    await tx
      .update(certificateOverrideRequests)
      .set({
        status: 'approved',
        decisionNote: input.decisionNote,
        decidedByUserId: input.userId,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(certificateOverrideRequests.id, record.request.id))
    await tx
      .update(certificateOverrideChanges)
      .set({
        status: 'approved',
        decisionNote: input.decisionNote,
        decidedByUserId: input.userId,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(certificateOverrideChanges.requestId, record.request.id))

    if (identityRevalidation) {
      const siblingCertificates = await tx
        .select({
          status: extractedCertificates.status,
          reasonCodes: extractedCertificates.reasonCodes,
        })
        .from(extractedCertificates)
        .where(
          eq(
            extractedCertificates.documentResultId,
            record.result.documentResultId,
          ),
        )
      const documentResult = aggregateDocumentStatus(siblingCertificates)
      await tx
        .update(documentResults)
        .set({
          status: documentResult.status,
          reasonCodes: documentResult.reasonCodes,
          updatedAt: now,
        })
        .where(eq(documentResults.id, record.result.documentResultId))
      await tx
        .update(intakeFiles)
        .set({
          processingStatus:
            documentResult.status === 'error'
              ? 'error'
              : documentResult.status === 'duplicate'
                ? 'duplicate'
                : 'success',
          errorMessage:
            documentResult.status === 'error'
              ? documentResult.reasonCodes.join(', ')
              : null,
          updatedAt: now,
        })
        .where(eq(intakeFiles.id, record.result.uploadId))
    }
  })

  const effectiveResult = {
    ...record.result,
    ...projectionPatch,
  } as CertificateResultRecord
  if (identityRevalidation && resolvedStatus === 'accepted') {
    await applyAutomaticReconciliationAfterCorrection({
      batchId: record.result.batchId,
      certificateId: record.result.id,
      uploadId: record.result.uploadId,
      sourceFileId: record.result.sourceFileId,
      originalFileName: record.result.originalFileName,
      normalized: {
        taxBase: effectiveResult.totalTaxBase,
        taxWithheld: effectiveResult.totalTaxWithheld,
      },
      metadata: {
        documentType: 'BIR2307',
        normalizedIssuerShortname: effectiveResult.payorShortName
          ? normalizeIssuerShortname(effectiveResult.payorShortName)
          : null,
        billingMonthMMYY: deriveBillingMonthMMYY(
          effectiveResult.periodEnd,
          effectiveResult.monthOfQuarter,
        ),
      },
    }).catch(() => ({ status: 'skipped' as const, rowCount: 0 }))
  }

  return {
    requestId: record.request.id,
    certificateId: record.result.id,
    matchedCount: identityRevalidation?.masterlistMatchCount ?? 0,
    status: resolvedStatus,
    immutableExtractedValues: record.result.immutableExtraction,
    effectiveValues: toEffectiveValues({
      ...record.result,
      ...projectionPatch,
    } as CertificateResultRecord),
  }
}

export const rejectCertificateOverrideRequest = async (
  input: DecideCertificateOverrideRequestInput,
) => {
  const record = await fetchDecisionRecord(input.requestId)
  if (!record) throw new Error('Correction request was not found.')
  if (record.request.status !== 'pending') {
    throw new Error('Only pending correction requests can be rejected.')
  }
  const now = new Date()
  return getDb().transaction(async (tx) => {
    const updated = await tx
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
    await tx
      .update(certificateOverrideChanges)
      .set({
        status: 'rejected',
        decisionNote: input.decisionNote,
        decidedByUserId: input.userId,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(certificateOverrideChanges.requestId, record.request.id))
    return updated.at(0)
  })
}

const toDisplayUser = (
  user: Pick<typeof authUserTable.$inferSelect, 'name' | 'email'> | undefined,
) => user?.name || user?.email || 'Unknown user'

const normalizeOverrideSearch = (value: string | null | undefined) =>
  (value ?? '').trim().slice(0, OVERRIDE_SEARCH_MAX)

const normalizeOverridePage = (value: number | null | undefined) =>
  Number.isFinite(value) && value ? Math.max(1, Math.floor(value)) : 1

const normalizeOverridePageSize = (value: number | null | undefined) => {
  const pageSize =
    Number.isFinite(value) && value ? Math.floor(value) : undefined
  return pageSize &&
    certificateOverridePageSizeOptions.some((option) => option === pageSize)
    ? pageSize
    : DEFAULT_CERTIFICATE_OVERRIDE_PAGE_SIZE
}

const buildOverrideListCondition = (
  status: CertificateOverrideStatus | 'all',
  query: string,
): SQL => {
  const conditions: Array<SQL> = []
  if (status !== 'all') {
    conditions.push(eq(certificateOverrideRequests.status, status))
  }
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`
    const tinQuery = normalizeTinDigits(query)
    conditions.push(sql`
      (
        concat_ws(
          ' ',
          ${certificateOverrideRequests.id}::text,
          ${certificateOverrideRequests.certificateId}::text,
          ${certificateOverrideRequests.requestNote},
          coalesce(${certificateOverrideRequests.decisionNote}, ''),
          ${certificateResults.originalFileName},
          coalesce(${certificateResults.entityShortName}, ''),
          ${certificateResults.payeeName},
          ${certificateResults.payorName},
          ${certificateResults.payorTin}
        ) ilike ${pattern} escape '\\'
        ${
          tinQuery
            ? sql`or regexp_replace(${certificateResults.payorTin}, '[^0-9]', '', 'g') like ${`%${tinQuery}%`}`
            : sql``
        }
      )
    `)
  }
  return conditions.length > 0 ? (and(...conditions) ?? sql`true`) : sql`true`
}

const toRequestView = (input: {
  request: OverrideRequestRecord
  result: CertificateResultRecord
  changes: Array<OverrideChangeRecord>
  requester?: typeof authUserTable.$inferSelect
  decider?: typeof authUserTable.$inferSelect
}): CertificateOverrideRequestView => ({
  id: input.request.id,
  certificateId: input.request.certificateId,
  uploadId: input.result.uploadId,
  batchId: input.result.batchId,
  status: input.request.status as CertificateOverrideStatus,
  fileName: input.result.originalFileName,
  entity: input.result.entityShortName?.trim() || 'Manual Upload',
  payee: input.result.payeeName || 'Unknown payee',
  payorName: input.result.payorName || 'Unknown payor',
  payorTin: input.result.payorTin ?? '',
  issueReason:
    input.result.reasonCodes.length > 0
      ? input.result.reasonCodes.join(', ')
      : 'Manual correction',
  requestNote: input.request.requestNote,
  requestedAt: input.request.createdAt.toISOString(),
  requestedByName: toDisplayUser(input.requester),
  requestedByEmail: input.requester?.email ?? null,
  decidedAt: input.request.decidedAt?.toISOString() ?? null,
  decidedByName: input.decider ? toDisplayUser(input.decider) : null,
  decisionNote: input.request.decisionNote,
  changes: input.changes.map((change) => ({
    fieldPath: change.fieldPath,
    originalValue: change.originalValue as JsonScalar,
    proposedValue: change.proposedValue as JsonScalar,
    status: change.status as CertificateOverrideStatus,
  })),
  immutableExtractedValues: input.result.immutableExtraction,
  effectiveValues: toEffectiveValues(input.result),
})

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
  const condition = buildOverrideListCondition(requestedStatus, query)
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
      .select({ count: sql<number>`count(*)::int` })
      .from(certificateOverrideRequests)
      .innerJoin(
        certificateResults,
        eq(certificateResults.id, certificateOverrideRequests.certificateId),
      )
      .where(condition),
  ])
  const totalItems = Number(totalRows.at(0)?.count ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const page = totalItems === 0 ? 1 : Math.min(requestedPage, totalPages)

  const pageRows = await db
    .select({
      requestId: certificateOverrideRequests.id,
    })
    .from(certificateOverrideRequests)
    .innerJoin(
      certificateResults,
      eq(certificateResults.id, certificateOverrideRequests.certificateId),
    )
    .where(condition)
    .orderBy(desc(certificateOverrideRequests.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const requestIds = pageRows.map((row) => row.requestId)
  const requests =
    requestIds.length === 0
      ? []
      : await db
          .select()
          .from(certificateOverrideRequests)
          .where(inArray(certificateOverrideRequests.id, requestIds))
  const resultIds = requests.map((request) => request.certificateId)
  const results =
    resultIds.length === 0
      ? []
      : await db
          .select()
          .from(certificateResults)
          .where(inArray(certificateResults.id, resultIds))
  const requestById = new Map(requests.map((request) => [request.id, request]))
  const resultById = new Map(results.map((result) => [result.id, result]))
  const rows = pageRows.flatMap(({ requestId }) => {
    const request = requestById.get(requestId)
    const result = request ? resultById.get(request.certificateId) : undefined
    return request && result ? [{ request, result }] : []
  })
  const userIds = Array.from(
    new Set(
      rows.flatMap((row) =>
        [row.request.requestedByUserId, row.request.decidedByUserId].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ),
  )
  const [changes, users] = await Promise.all([
    requestIds.length === 0
      ? []
      : db
          .select()
          .from(certificateOverrideChanges)
          .where(inArray(certificateOverrideChanges.requestId, requestIds)),
    userIds.length === 0
      ? []
      : db
          .select()
          .from(authUserTable)
          .where(inArray(authUserTable.id, userIds)),
  ])
  const userById = new Map(users.map((user) => [user.id, user]))

  const summary = { pending: 0, approved: 0, rejected: 0 }
  summaryRows.forEach((row) => {
    if (row.status in summary) {
      summary[row.status as CertificateOverrideStatus] = Number(row.count)
    }
  })

  return {
    requests: rows.map((row) =>
      toRequestView({
        ...row,
        changes: changes.filter(
          (change) => change.requestId === row.request.id,
        ),
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
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  }
}
