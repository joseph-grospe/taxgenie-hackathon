import { createHash } from 'node:crypto'

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { SQL } from 'drizzle-orm'

import { getDb } from '@/lib/db'
import {
  atcCodes,
  authUserTable,
  certificateOverrideChanges,
  certificateOverrideRequests,
  certificateResults,
  certificateTaxRows,
  extractedCertificates,
  intakeFiles,
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
  if (input.result.status !== 'accepted' && input.result.status !== 'error') {
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

  const now = new Date()
  const fingerprint = stableFingerprint(
    record.result,
    projectionPatch,
    record.taxRows,
    taxRowPatches,
  )
  await getDb().transaction(async (tx: DbTransaction) => {
    await tx
      .update(extractedCertificates)
      .set({ ...projectionPatch, fingerprint, updatedAt: now })
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
  })

  return {
    requestId: record.request.id,
    certificateId: record.result.id,
    matchedCount: 0,
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
