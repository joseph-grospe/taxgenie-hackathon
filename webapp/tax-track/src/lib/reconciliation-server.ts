import {
  normalizeIssuerShortname,
  parseCertificateFileName as parseSharedCertificateFileName,
} from '@taxtrack/shared'
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
} from 'drizzle-orm'
import * as XLSX from 'xlsx'
import type { ParsedCertificateFileMetadata } from '@taxtrack/shared'

import type {
  ReconciliationListView,
  ReconciliationMatchStatus,
  ReconciliationRowView,
  ReconciliationSummaryView,
} from '@/lib/reconciliation-types'
import { getDb } from '@/lib/db'
import {
  documentResults,
  intakeBatches,
  intakeFiles,
  masterlist,
  reconciliationResults,
} from '@/lib/schema'

const MAX_RECONCILIATION_ROWS = 3_000
const BULK_INSERT_CHUNK_SIZE = 500
const LOOKUP_CHUNK_SIZE = 500

export const requiredReconciliationHeaders = [
  'Customer Name',
  'TIN',
  'Invoice Number',
  'Accounting Date',
  'Transaction Line Description',
  'Taxable Sales',
  'Output VAT',
  'Prepaid CWT',
] as const

type RequiredReconciliationHeader =
  (typeof requiredReconciliationHeaders)[number]

type JsonRecord = Record<string, unknown>

type ParsedWorkbookRow = {
  customerName: string
  tin: string
  invoiceNumber: string
  accountingDate: string | null
  transactionLineDescription: string
  taxableSales: number
  outputVAT: number
  prepaidCWT: number
  issuerShortnameUsedForMatch: string
  derivedBillingMonthMMYY: string
}

type ParsedCertificateMetadata = ParsedCertificateFileMetadata

export type CertificateFileMetadata = ParsedCertificateMetadata

export type TaxRecordCandidate = {
  uploadId: string
  sourceFileId: string
  taxRecordId: number
  fileName: string
  uploadedAt: Date | null
  fileCreatedAt: Date
  resultCreatedAt: Date
  taxBase: number | null
  taxWithheld: number | null
  metadata: ParsedCertificateMetadata
}

type WorkbookValidationResult = {
  headerIndexes: Record<RequiredReconciliationHeader, number>
  rows: Array<Array<unknown>>
}

type DifferenceResult = {
  taxBaseDifference: number
  taxWithheldDifference: number
  hasDifference: boolean
}

type ResolvedWorkbookRow = ParsedWorkbookRow & {
  masterlistIssuerShortname: string | null
}

type MasterlistShortNameRecord = Pick<
  typeof masterlist.$inferSelect,
  'shortName' | 'customerName'
>

type ReconciliationInsert = typeof reconciliationResults.$inferInsert
type ReconciliationRecord = typeof reconciliationResults.$inferSelect

type ImportReconciliationOptions = {
  uploadBatchId: string
  userId?: string
  replaceExisting?: boolean
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toRecord = (value: unknown): JsonRecord => (isRecord(value) ? value : {})

const roundMoney = (value: number) => Number(value.toFixed(2))

const toTrimmedString = (value: unknown): string => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }

  if (typeof value === 'string') {
    return value.trim()
  }

  return ''
}

const normalizeHeaderRow = (headerRow: Array<unknown>) =>
  headerRow.map((header) => toTrimmedString(header))

const isRowEmpty = (row: Array<unknown>) =>
  row.every((cell) => toTrimmedString(cell).length === 0)

const parseNumericValue = (
  value: unknown,
  label: string,
  rowNumber: number,
  options?: {
    allowBlank?: boolean
    blankValue?: number
  },
): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return roundMoney(value)
  }

  const raw = toTrimmedString(value)
  if (!raw) {
    if (options?.allowBlank) {
      return roundMoney(options.blankValue ?? 0)
    }

    throw new Error(`Row ${rowNumber}: ${label} is required.`)
  }

  const normalized = raw.replace(/,/g, '')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Row ${rowNumber}: ${label} must be a valid number.`)
  }

  return roundMoney(parsed)
}

const parseDateString = (value: string) => {
  const buildUtcDate = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day))

    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null
    }

    return date
  }

  const isoMatch = value.match(/^(\d{4})[./-](\d{2})[./-](\d{2})$/)
  if (isoMatch) {
    const year = Number.parseInt(isoMatch[1], 10)
    const month = Number.parseInt(isoMatch[2], 10)
    const day = Number.parseInt(isoMatch[3], 10)
    return buildUtcDate(year, month, day)
  }

  const usMatch = value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/)
  if (usMatch) {
    const month = Number.parseInt(usMatch[1], 10)
    const day = Number.parseInt(usMatch[2], 10)
    const year = Number.parseInt(usMatch[3], 10)
    return buildUtcDate(year, month, day)
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const toIsoDateString = (value: unknown): string | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) {
      return null
    }

    const date = new Date(
      Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S),
    )
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }

  const raw = toTrimmedString(value)
  if (!raw) {
    return null
  }

  return parseDateString(raw)?.toISOString().slice(0, 10) ?? raw
}

const MONTH_NAME_TO_NUMBER: Record<string, string> = {
  january: '01',
  jan: '01',
  february: '02',
  feb: '02',
  march: '03',
  mar: '03',
  april: '04',
  apr: '04',
  may: '05',
  june: '06',
  jun: '06',
  july: '07',
  jul: '07',
  august: '08',
  aug: '08',
  september: '09',
  sep: '09',
  sept: '09',
  october: '10',
  oct: '10',
  november: '11',
  nov: '11',
  december: '12',
  dec: '12',
}

export const deriveBillingMonthMMYY = (description: string): string => {
  const toBillingMonth = (date: Date) => {
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const year = String(date.getUTCFullYear()).slice(-2)
    return `${month}${year}`
  }

  const rangeMatch = description.match(
    /(\d{4}[./-]\d{2}[./-]\d{2})\s*-\s*(\d{4}[./-]\d{2}[./-]\d{2})/,
  )

  if (rangeMatch) {
    const endDate = parseDateString(rangeMatch[2])
    if (!endDate) {
      throw new Error('Malformed billing date range.')
    }

    return toBillingMonth(endDate)
  }

  const monthYearMatch = description.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(\d{4})\b/i,
  )

  if (monthYearMatch) {
    const month = MONTH_NAME_TO_NUMBER[monthYearMatch[1].toLowerCase()]
    const year = monthYearMatch[2].slice(-2)

    if (month) {
      return `${month}${year}`
    }
  }

  const singleDateMatch = description.match(/\b(\d{4}[./-]\d{2}[./-]\d{2})\b/)
  if (singleDateMatch) {
    const date = parseDateString(singleDateMatch[1])
    if (!date) {
      throw new Error('Malformed billing date range.')
    }

    return toBillingMonth(date)
  }

  throw new Error('Malformed billing date range.')
}

export const parseCertificateFileName = (
  fileName: string,
): ParsedCertificateMetadata | null => parseSharedCertificateFileName(fileName)

const parseWorkbookRows = (buffer: Buffer) => {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
  })

  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error('Upload processing failure: workbook is empty.')
  }

  const firstSheet = workbook.Sheets[firstSheetName]
  const rawRows: Array<Array<unknown>> = XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    raw: true,
    blankrows: false,
  })

  if (rawRows.length === 0) {
    throw new Error('Upload processing failure: workbook is empty.')
  }

  return rawRows
}

const validateWorkbookRows = (
  rawRows: Array<Array<unknown>>,
): WorkbookValidationResult => {
  const headerRow = normalizeHeaderRow(rawRows[0] ?? [])
  const headerIndexes = {} as Record<RequiredReconciliationHeader, number>
  const missingHeaders: Array<string> = []

  for (const header of requiredReconciliationHeaders) {
    const index = headerRow.indexOf(header)
    if (index === -1) {
      missingHeaders.push(header)
      continue
    }

    headerIndexes[header] = index
  }

  if (missingHeaders.length > 0) {
    throw new Error(`Missing required headers: ${missingHeaders.join(', ')}.`)
  }

  const dataRows = rawRows.slice(1).filter((row) => !isRowEmpty(row))
  if (dataRows.length > MAX_RECONCILIATION_ROWS) {
    throw new Error(
      `Upload processing failure: workbook exceeds ${MAX_RECONCILIATION_ROWS} rows.`,
    )
  }

  return { headerIndexes, rows: dataRows }
}

export const parseReconciliationWorkbook = (buffer: Buffer) => {
  const rawRows = parseWorkbookRows(buffer)
  const { headerIndexes, rows } = validateWorkbookRows(rawRows)

  return rows.map<ParsedWorkbookRow>((row, index) => {
    const rowNumber = index + 2
    const customerName = toTrimmedString(row[headerIndexes['Customer Name']])
    const tin = toTrimmedString(row[headerIndexes.TIN])
    const invoiceNumber = toTrimmedString(row[headerIndexes['Invoice Number']])
    const transactionLineDescription = toTrimmedString(
      row[headerIndexes['Transaction Line Description']],
    )

    if (!customerName) {
      throw new Error(`Row ${rowNumber}: Customer Name is required.`)
    }
    if (!tin) {
      throw new Error(`Row ${rowNumber}: TIN is required.`)
    }
    if (!invoiceNumber) {
      throw new Error(`Row ${rowNumber}: Invoice Number is required.`)
    }
    if (!transactionLineDescription) {
      throw new Error(
        `Row ${rowNumber}: Transaction Line Description is required.`,
      )
    }

    let derivedBillingMonthMMYY = ''
    try {
      derivedBillingMonthMMYY = deriveBillingMonthMMYY(
        transactionLineDescription,
      )
    } catch {
      throw new Error(
        `Row ${rowNumber}: malformed billing date range in Transaction Line Description.`,
      )
    }

    return {
      customerName,
      tin,
      invoiceNumber,
      accountingDate: toIsoDateString(row[headerIndexes['Accounting Date']]),
      transactionLineDescription,
      taxableSales: parseNumericValue(
        row[headerIndexes['Taxable Sales']],
        'Taxable Sales',
        rowNumber,
      ),
      outputVAT: parseNumericValue(
        row[headerIndexes['Output VAT']],
        'Output VAT',
        rowNumber,
        {
          allowBlank: true,
          blankValue: 0,
        },
      ),
      prepaidCWT: parseNumericValue(
        row[headerIndexes['Prepaid CWT']],
        'Prepaid CWT',
        rowNumber,
        {
          allowBlank: true,
          blankValue: 0,
        },
      ),
      issuerShortnameUsedForMatch: normalizeIssuerShortname(customerName),
      derivedBillingMonthMMYY,
    }
  })
}

const toNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return roundMoney(value)
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return roundMoney(parsed)
    }
  }

  return null
}

const computeDifferences = (
  taxBase: number | null,
  taxWithheld: number | null,
  taxableSales: number,
  prepaidCWT: number,
): DifferenceResult => {
  const taxBaseDifference = roundMoney((taxBase ?? 0) - taxableSales)
  const normalizedPrepaidCWT = Math.abs(prepaidCWT)
  const taxWithheldDifference = roundMoney(
    (taxWithheld ?? 0) - normalizedPrepaidCWT,
  )

  return {
    taxBaseDifference,
    taxWithheldDifference,
    hasDifference: taxBaseDifference !== 0 || taxWithheldDifference !== 0,
  }
}

export const buildDifferenceValues = computeDifferences

export const buildMasterlistShortNameLookup = (
  rows: Array<MasterlistShortNameRecord>,
) => {
  const lookup = new Map<string, string>()

  for (const row of rows) {
    const shortName = row.shortName?.trim()
    if (!shortName) {
      continue
    }

    const normalizedShortName = normalizeIssuerShortname(shortName)
    if (normalizedShortName) {
      lookup.set(normalizedShortName, normalizedShortName)
    }

    const normalizedCustomerName = normalizeIssuerShortname(
      row.customerName ?? '',
    )
    if (normalizedCustomerName && !lookup.has(normalizedCustomerName)) {
      lookup.set(normalizedCustomerName, normalizedShortName)
    }
  }

  return lookup
}

const escapeLikePattern = (value: string) => value.replaceAll(/[%_\\]/g, '\\$&')

const pickBestMasterlistMatch = (
  customerName: string,
  rows: Array<MasterlistShortNameRecord>,
): MasterlistShortNameRecord | undefined => {
  const requestedName = customerName.trim()
  const requestedNameLower = requestedName.toLowerCase()
  const normalizedRequestedName = normalizeIssuerShortname(requestedName)

  return rows
    .filter((row) => {
      const rowCustomerName = row.customerName?.trim()
      const shortName = row.shortName?.trim()

      return (
        Boolean(shortName) &&
        Boolean(rowCustomerName) &&
        rowCustomerName!.toLowerCase().includes(requestedNameLower)
      )
    })
    .sort((left, right) => {
      const leftCustomerName = left.customerName?.trim() ?? ''
      const rightCustomerName = right.customerName?.trim() ?? ''
      const leftNormalizedCustomerName =
        normalizeIssuerShortname(leftCustomerName)
      const rightNormalizedCustomerName =
        normalizeIssuerShortname(rightCustomerName)

      const leftExactMatch =
        leftNormalizedCustomerName === normalizedRequestedName ? 0 : 1
      const rightExactMatch =
        rightNormalizedCustomerName === normalizedRequestedName ? 0 : 1

      if (leftExactMatch !== rightExactMatch) {
        return leftExactMatch - rightExactMatch
      }

      if (leftCustomerName.length !== rightCustomerName.length) {
        return leftCustomerName.length - rightCustomerName.length
      }

      return leftCustomerName.localeCompare(rightCustomerName)
    })[0]
}

export const buildMasterlistShortNameLookupFromLikeMatches = (
  customerNames: Array<string>,
  rows: Array<MasterlistShortNameRecord>,
) => {
  const lookup = new Map<string, string>()

  for (const customerName of customerNames) {
    const requestedName = customerName.trim()
    if (!requestedName) {
      continue
    }

    const bestMatch = pickBestMasterlistMatch(requestedName, rows)
    const shortName = bestMatch?.shortName?.trim()
    if (!shortName) {
      continue
    }

    lookup.set(
      normalizeIssuerShortname(requestedName),
      normalizeIssuerShortname(shortName),
    )
  }

  return lookup
}

export const resolveMasterlistIssuerShortname = (
  customerName: string,
  masterlistLookup: Map<string, string>,
) => {
  const normalizedCustomerName = normalizeIssuerShortname(customerName)

  return masterlistLookup.get(normalizedCustomerName) ?? null
}

const fetchMasterlistShortNameLookupForCustomers = async (
  customerNames: Array<string>,
) => {
  const requestedCustomerNames = Array.from(
    new Set(customerNames.map((name) => name.trim()).filter(Boolean)),
  )

  if (requestedCustomerNames.length === 0) {
    return new Map<string, string>()
  }

  const db = getDb()
  const rows: Array<MasterlistShortNameRecord> = []

  console.log({ customerNames })

  for (const chunk of chunkItems(requestedCustomerNames, LOOKUP_CHUNK_SIZE)) {
    const batch = await db
      .select({
        shortName: masterlist.shortName,
        customerName: masterlist.customerName,
      })
      .from(masterlist)
      .where(
        or(
          ...chunk.map((customerName) =>
            ilike(
              masterlist.customerName,
              `%${escapeLikePattern(customerName)}%`,
            ),
          ),
        ),
      )

    rows.push(...batch)
  }

  console.log({ rows })

  return buildMasterlistShortNameLookupFromLikeMatches(
    requestedCustomerNames,
    rows,
  )
}

const buildRequestedCandidateFilters = (rows: Array<ResolvedWorkbookRow>) => ({
  issuerShortnames: Array.from(
    new Set(
      rows
        .map((row) => row.masterlistIssuerShortname)
        .filter((value): value is string => Boolean(value)),
    ),
  ),
  billingMonths: Array.from(
    new Set(
      rows
        .map((row) => row.derivedBillingMonthMMYY)
        .filter((value) => value.length > 0),
    ),
  ),
})

const fetchTaxRecordCandidates = async (
  rows: Array<ResolvedWorkbookRow>,
  options: { uploadBatchId?: string } = {},
) => {
  const { issuerShortnames, billingMonths } =
    buildRequestedCandidateFilters(rows)

  if (issuerShortnames.length === 0 || billingMonths.length === 0) {
    return []
  }

  const db = getDb()
  const matchedIntakeRows: Array<{
    uploadId: string
    sourceFileId: string | null
    fileName: string
    uploadedAt: Date | null
    fileCreatedAt: Date
    certificateDocumentType: string | null
    certificateIssuerShortName: string | null
    certificateIssuerShortNameNormalized: string | null
    certificateRecipientShortName: string | null
    certificateSettlementReferenceNumber: string | null
    certificateBillingMonthMMYY: string | null
    certificateDateUploaded: string | null
  }> = []

  for (const issuerChunk of chunkItems(issuerShortnames, LOOKUP_CHUNK_SIZE)) {
    for (const billingMonthChunk of chunkItems(
      billingMonths,
      LOOKUP_CHUNK_SIZE,
    )) {
      const batch = await db
        .select({
          uploadId: intakeFiles.id,
          sourceFileId: intakeFiles.sourceFileId,
          fileName: intakeFiles.originalFileName,
          uploadedAt: intakeFiles.uploadedAt,
          fileCreatedAt: intakeFiles.createdAt,
          certificateDocumentType: intakeFiles.certificateDocumentType,
          certificateIssuerShortName: intakeFiles.certificateIssuerShortName,
          certificateIssuerShortNameNormalized:
            intakeFiles.certificateIssuerShortNameNormalized,
          certificateRecipientShortName:
            intakeFiles.certificateRecipientShortName,
          certificateSettlementReferenceNumber:
            intakeFiles.certificateSettlementReferenceNumber,
          certificateBillingMonthMMYY: intakeFiles.certificateBillingMonthMMYY,
          certificateDateUploaded: intakeFiles.certificateDateUploaded,
        })
        .from(intakeFiles)
        .where(
          and(
            eq(intakeFiles.certificateDocumentType, 'BIR2307'),
            inArray(
              intakeFiles.certificateIssuerShortNameNormalized,
              issuerChunk,
            ),
            inArray(intakeFiles.certificateBillingMonthMMYY, billingMonthChunk),
            isNotNull(intakeFiles.sourceFileId),
            options.uploadBatchId
              ? eq(intakeFiles.batchId, options.uploadBatchId)
              : undefined,
          ),
        )

      matchedIntakeRows.push(...batch)
    }
  }

  const requestedSourceFileIds = Array.from(
    new Set(
      matchedIntakeRows
        .map((row) => row.sourceFileId)
        .filter((value): value is string => Boolean(value)),
    ),
  )

  if (requestedSourceFileIds.length === 0) {
    return []
  }

  const successfulResults: Array<{
    taxRecordId: number
    uploadId: string
    sourceFileId: string
    payload: unknown
    resultCreatedAt: Date
  }> = []

  for (const chunk of chunkItems(requestedSourceFileIds, LOOKUP_CHUNK_SIZE)) {
    const batch = await db
      .select({
        taxRecordId: documentResults.id,
        uploadId: documentResults.uploadId,
        sourceFileId: documentResults.sourceFileId,
        payload: documentResults.payload,
        resultCreatedAt: documentResults.createdAt,
      })
      .from(documentResults)
      .where(
        and(
          eq(documentResults.status, 'success'),
          inArray(documentResults.sourceFileId, chunk),
        ),
      )
      .orderBy(desc(documentResults.createdAt))

    successfulResults.push(...batch)
  }

  const latestResultBySourceFileId = new Map<
    string,
    (typeof successfulResults)[number]
  >()

  for (const result of successfulResults) {
    if (!latestResultBySourceFileId.has(result.sourceFileId)) {
      latestResultBySourceFileId.set(result.sourceFileId, result)
    }
  }

  return matchedIntakeRows.flatMap<TaxRecordCandidate>((row) => {
    if (!row.sourceFileId) {
      return []
    }

    const metadata =
      row.certificateDocumentType &&
      row.certificateIssuerShortName &&
      row.certificateIssuerShortNameNormalized &&
      row.certificateRecipientShortName &&
      row.certificateSettlementReferenceNumber &&
      row.certificateBillingMonthMMYY &&
      row.certificateDateUploaded
        ? {
            documentType: row.certificateDocumentType,
            issuerShortname: row.certificateIssuerShortName,
            normalizedIssuerShortname: row.certificateIssuerShortNameNormalized,
            recipientShortname: row.certificateRecipientShortName,
            settlementReferenceNumber: row.certificateSettlementReferenceNumber,
            billingMonthMMYY: row.certificateBillingMonthMMYY,
            dateUploaded: row.certificateDateUploaded,
          }
        : parseCertificateFileName(row.fileName)

    if (!metadata || metadata.documentType.toUpperCase() !== 'BIR2307') {
      return []
    }

    const result = latestResultBySourceFileId.get(row.sourceFileId)
    if (!result) {
      return []
    }

    const normalized = toRecord(toRecord(result.payload).normalized)
    return [
      {
        uploadId: row.uploadId,
        sourceFileId: row.sourceFileId,
        taxRecordId: result.taxRecordId,
        fileName: row.fileName,
        uploadedAt: row.uploadedAt,
        fileCreatedAt: row.fileCreatedAt,
        resultCreatedAt: result.resultCreatedAt,
        taxBase: toNumberValue(normalized.taxBase),
        taxWithheld: toNumberValue(normalized.taxWithheld),
        metadata,
      },
    ]
  })
}

export const pickBestTaxRecordMatch = (
  row: Pick<
    ParsedWorkbookRow,
    'issuerShortnameUsedForMatch' | 'derivedBillingMonthMMYY'
  >,
  candidates: Array<TaxRecordCandidate>,
) => {
  return candidates
    .filter(
      (candidate) =>
        candidate.metadata.normalizedIssuerShortname ===
          row.issuerShortnameUsedForMatch &&
        candidate.metadata.billingMonthMMYY === row.derivedBillingMonthMMYY,
    )
    .sort((left, right) => {
      const leftUploadedAt = (left.uploadedAt ?? left.fileCreatedAt).getTime()
      const rightUploadedAt = (
        right.uploadedAt ?? right.fileCreatedAt
      ).getTime()

      if (leftUploadedAt !== rightUploadedAt) {
        return rightUploadedAt - leftUploadedAt
      }

      return right.resultCreatedAt.getTime() - left.resultCreatedAt.getTime()
    })[0]
}

const chunkItems = <TItem>(items: Array<TItem>, size: number) => {
  const chunks: Array<Array<TItem>> = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

const mapRecordToView = (
  record: ReconciliationRecord,
): ReconciliationRowView => ({
  id: record.id,
  uploadBatchId: record.uploadBatchId,
  requestingEntityShortName: record.requestingEntityShortName,
  customerName: record.customerName,
  tin: record.tin,
  invoiceNumber: record.invoiceNumber,
  accountingDate: record.accountingDate,
  transactionLineDescription: record.transactionLineDescription,
  taxableSales: roundMoney(record.taxableSales),
  outputVAT: roundMoney(record.outputVAT),
  prepaidCWT: roundMoney(record.prepaidCWT),
  issuerShortnameUsedForMatch: record.issuerShortnameUsedForMatch,
  derivedBillingMonthMMYY: record.derivedBillingMonthMMYY,
  matchedTaxRecordId: record.matchedTaxRecordId,
  taxBase: record.taxBase === null ? null : roundMoney(record.taxBase),
  taxWithheld:
    record.taxWithheld === null ? null : roundMoney(record.taxWithheld),
  taxBaseDifference: roundMoney(record.taxBaseDifference),
  taxWithheldDifference: roundMoney(record.taxWithheldDifference),
  hasDifference: record.hasDifference,
  matchStatus: record.matchStatus as ReconciliationMatchStatus,
  emailSentAt: record.emailSentAt?.toISOString() ?? null,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
})

const buildSummary = (
  rows: Array<ReconciliationRowView>,
): ReconciliationSummaryView => ({
  totalRecords: rows.length,
  matched: rows.filter((row) => row.matchStatus === 'matched').length,
  unmatched: rows.filter((row) => row.matchStatus === 'unmatched').length,
  varianceTotal: roundMoney(
    rows.reduce(
      (total, row) =>
        total +
        Math.abs(row.taxBaseDifference) +
        Math.abs(row.taxWithheldDifference),
      0,
    ),
  ),
})

export const isExcelFileUpload = (file: Pick<File, 'name'>) =>
  /\.(xlsx|xls)$/iu.test(file.name.trim())

export const parseRequestingEntityShortNameFromWorkbookFileName = (
  fileName: string,
) => {
  const match = fileName.trim().match(/^(.+)_SALES_REPORT\.(xlsx|xls)$/iu)
  const shortName = match?.[1]?.trim()

  if (!shortName) {
    throw new Error(
      'Reconciliation workbook filename must use {{ENTITY_SHORT_NAME}}_SALES_REPORT.xlsx or {{ENTITY_SHORT_NAME}}_SALES_REPORT.xls.',
    )
  }

  return shortName
}

const assertBatchReadyForReconciliation = async (input: {
  uploadBatchId: string
  userId?: string
}) => {
  const db = getDb()
  const batches = await db
    .select()
    .from(intakeBatches)
    .where(eq(intakeBatches.id, input.uploadBatchId))
    .limit(1)
  const batch = batches.at(0) ?? null

  if (!batch) {
    throw new Error('Upload batch not found.')
  }

  if (input.userId && batch.createdByUserId !== input.userId) {
    throw new Error(
      'You do not have permission to reconcile this upload batch.',
    )
  }

  if (batch.status !== 'closed') {
    throw new Error(
      'Close this upload batch before importing revenue data for reconciliation.',
    )
  }

  const completedResults = await db
    .select({ id: documentResults.id })
    .from(documentResults)
    .where(
      and(
        eq(documentResults.batchId, input.uploadBatchId),
        eq(documentResults.status, 'success'),
      ),
    )
    .limit(1)
  const completedResult = completedResults.at(0) ?? null

  if (!completedResult) {
    throw new Error(
      'This batch has no completed extraction results available for reconciliation.',
    )
  }
}

export const importReconciliationWorkbook = async (
  file: Pick<File, 'name' | 'arrayBuffer'>,
  options: ImportReconciliationOptions,
): Promise<ReconciliationListView> => {
  if (!isExcelFileUpload(file)) {
    throw new Error(
      'Invalid file type. Only Excel files (.xlsx, .xls) are supported.',
    )
  }

  const requestingEntityShortName =
    parseRequestingEntityShortNameFromWorkbookFileName(file.name)

  await assertBatchReadyForReconciliation({
    uploadBatchId: options.uploadBatchId,
    userId: options.userId,
  })

  const buffer = Buffer.from(await file.arrayBuffer())
  const parsedRows = parseReconciliationWorkbook(buffer)
  const masterlistLookup = await fetchMasterlistShortNameLookupForCustomers(
    parsedRows.map((row) => row.customerName),
  )

  console.log({ masterlistLookup })
  const resolvedRows = parsedRows.map<ResolvedWorkbookRow>((row) => {
    const masterlistIssuerShortname = resolveMasterlistIssuerShortname(
      row.customerName,
      masterlistLookup,
    )

    return {
      ...row,
      masterlistIssuerShortname,
      issuerShortnameUsedForMatch:
        masterlistIssuerShortname ?? normalizeIssuerShortname(row.customerName),
    }
  })

  console.log({ resolvedRows })
  const candidates = await fetchTaxRecordCandidates(resolvedRows, {
    uploadBatchId: options.uploadBatchId,
  })
  console.log({ candidates })

  const insertRows = resolvedRows.map<ReconciliationInsert>((row) => {
    const match = row.masterlistIssuerShortname
      ? pickBestTaxRecordMatch(
          {
            issuerShortnameUsedForMatch: row.masterlistIssuerShortname,
            derivedBillingMonthMMYY: row.derivedBillingMonthMMYY,
          },
          candidates,
        )
      : undefined
    const taxBase = match?.taxBase ?? null
    const taxWithheld = match?.taxWithheld ?? null
    const difference = computeDifferences(
      taxBase,
      taxWithheld,
      row.taxableSales,
      row.prepaidCWT,
    )

    return {
      uploadBatchId: options.uploadBatchId,
      requestingEntityShortName,
      customerName: row.customerName,
      tin: row.tin,
      invoiceNumber: row.invoiceNumber,
      accountingDate: row.accountingDate,
      transactionLineDescription: row.transactionLineDescription,
      taxableSales: row.taxableSales,
      outputVAT: row.outputVAT,
      prepaidCWT: row.prepaidCWT,
      issuerShortnameUsedForMatch: row.issuerShortnameUsedForMatch,
      derivedBillingMonthMMYY: row.derivedBillingMonthMMYY,
      matchedTaxRecordId: match?.taxRecordId ?? null,
      taxBase,
      taxWithheld,
      taxBaseDifference: difference.taxBaseDifference,
      taxWithheldDifference: difference.taxWithheldDifference,
      hasDifference: difference.hasDifference,
      matchStatus: match ? 'matched' : 'unmatched',
      emailSentAt: null,
    }
  })

  const db = getDb()
  const insertedRows = await db.transaction(async (tx) => {
    const inserted: Array<ReconciliationRecord> = []

    if (options.replaceExisting) {
      await tx
        .delete(reconciliationResults)
        .where(eq(reconciliationResults.uploadBatchId, options.uploadBatchId))
    }

    for (const chunk of chunkItems(insertRows, BULK_INSERT_CHUNK_SIZE)) {
      const batch = await tx
        .insert(reconciliationResults)
        .values(chunk)
        .returning()
      inserted.push(...batch)
    }

    return inserted
  })

  const views = insertedRows
    .map(mapRecordToView)
    .sort((left, right) => right.id - left.id)

  return {
    rows: views,
    summary: buildSummary(views),
  }
}

export const listReconciliationResults =
  async (): Promise<ReconciliationListView> => {
    const db = getDb()
    const rows = await db
      .select()
      .from(reconciliationResults)
      .orderBy(
        desc(reconciliationResults.createdAt),
        desc(reconciliationResults.id),
      )

    const views = rows.map(mapRecordToView)
    return {
      rows: views,
      summary: buildSummary(views),
    }
  }

export const getReconciliationRow = async (rowId: number) => {
  const db = getDb()
  const rows = await db
    .select()
    .from(reconciliationResults)
    .where(eq(reconciliationResults.id, rowId))
    .limit(1)
  const row = rows.at(0) ?? null

  return row ? mapRecordToView(row) : null
}

export const getPendingReconciliationCustomerEmailRows = async (
  anchor: Pick<
    ReconciliationRowView,
    'uploadBatchId' | 'customerName' | 'tin' | 'requestingEntityShortName'
  >,
) => {
  const requestingEntityShortName = anchor.requestingEntityShortName?.trim()
  if (!requestingEntityShortName) {
    return []
  }

  const db = getDb()
  const rows = await db
    .select()
    .from(reconciliationResults)
    .where(
      and(
        eq(reconciliationResults.uploadBatchId, anchor.uploadBatchId),
        eq(reconciliationResults.customerName, anchor.customerName),
        eq(reconciliationResults.tin, anchor.tin),
        eq(
          reconciliationResults.requestingEntityShortName,
          requestingEntityShortName,
        ),
        eq(reconciliationResults.matchStatus, 'unmatched'),
        eq(reconciliationResults.hasDifference, true),
        isNull(reconciliationResults.emailSentAt),
      ),
    )
    .orderBy(
      asc(reconciliationResults.derivedBillingMonthMMYY),
      asc(reconciliationResults.invoiceNumber),
      asc(reconciliationResults.id),
    )

  return rows.map(mapRecordToView)
}

export const getLatestReconciliationBatch = async (uploadBatchId: string) => {
  const db = getDb()
  const rows = await db
    .select()
    .from(reconciliationResults)
    .where(eq(reconciliationResults.uploadBatchId, uploadBatchId))
    .orderBy(
      desc(reconciliationResults.createdAt),
      desc(reconciliationResults.id),
    )

  const views = rows.map(mapRecordToView)
  return {
    rows: views,
    summary: buildSummary(views),
  }
}
