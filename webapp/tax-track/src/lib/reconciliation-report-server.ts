import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'
import {
  normalizeIssuerShortname,
  parseCertificateFileName,
} from '@taxtrack/shared'
import type { ParsedCertificateFileMetadata } from '@taxtrack/shared'
import type { SQL } from 'drizzle-orm'

import type { ReconciliationExportGranularity } from '@/lib/reconciliation-report'
import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { calculateDaysUncollected } from '@/lib/reconciliation-aging'
import { getDb } from '@/lib/db'
import { resolveEntityScopeFilterById } from '@/lib/entities-server'
import { buildReconciliationCustomerNameCondition } from '@/lib/reconciliation-server'
import { RECONCILIATION_ATTACHMENT_TEMPLATE_BASE64 } from '@/lib/reconciliation-email-template'
import {
  formatAnnualLabel,
  formatBillingPeriod,
  formatQuarterLabel,
  getQuarterFromBillingMonth,
  parseBillingMonthMMYY,
} from '@/lib/reconciliation-report'
import {
  certificateResults,
  intakeFiles,
  reconciliationResultCollections,
  reconciliationResults,
  salesReportRunBatches,
  salesReportRuns,
  salesReports,
} from '@/lib/schema'

const RECON_ATTACHMENT_SHEET_NAME = 'Sample 2307 Recon Format'
const RECON_ATTACHMENT_RANGE_START_COLUMN = 2
const RECON_ATTACHMENT_RANGE_END_COLUMN = 13
const RECON_ATTACHMENT_RANGE_START_ROW = 2
const RECON_DATA_START_ROW = 4
const THIN_BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
} as const

const roundMoney = (value: number) => Math.round(value * 100) / 100
const MONTH_OF_QUARTER_INDEX = {
  first: 0,
  second: 1,
  third: 2,
} as const

type JsonRecord = Record<string, unknown>

export type ReconciliationWorkbookRow = {
  shortName: string | null
  tin: string | null
  customerName: string | null
  invoiceNumber: string | null
  billingMonthMMYY: string
  accountingDate: string | null
  taxableSales: number | null
  prepaidCWT: number | null
  collectedTaxBase: number | null
  collectedPrepaidCWT: number | null
  taxBaseDifference: number | null
  prepaidCWTDifference: number | null
}

export type CollectedTaxRecordExportCandidate = {
  taxRecordId: number
  batchId: string
  sourceFileId: string
  fileName: string
  resultCreatedAt: Date
  taxBase: number | null
  taxWithheld: number | null
  metadata: ParsedCertificateFileMetadata
  payeeName: string | null
  payorName: string | null
}

const toText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const toNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return roundMoney(value)
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/gu, ''))
    if (Number.isFinite(parsed)) {
      return roundMoney(parsed)
    }
  }

  return null
}

const normalizeDocumentType = (value: string | null | undefined) =>
  (value ?? '').replaceAll(/[^a-zA-Z0-9]/g, '').toUpperCase()

const isBir2307Metadata = (metadata: ParsedCertificateFileMetadata) =>
  normalizeDocumentType(metadata.documentType) === 'BIR2307'

const parseDateParts = (
  year: number,
  month: number,
  day: number,
): { year: number; monthIndex: number } | null => {
  if (![year, month, day].every(Number.isFinite)) {
    return null
  }

  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return { year, monthIndex: month - 1 }
}

const parseSingleDate = (
  value: string,
): { year: number; monthIndex: number } | null => {
  const clean = value.trim()
  const isoMatch = clean.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/u)
  if (isoMatch) {
    return parseDateParts(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    )
  }

  const usMatch = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/u)
  if (usMatch) {
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3]
    return parseDateParts(Number(year), Number(usMatch[1]), Number(usMatch[2]))
  }

  return null
}

const extractPeriodEndDate = (
  value: unknown,
): { year: number; monthIndex: number } | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      year: value.getFullYear(),
      monthIndex: value.getMonth(),
    }
  }

  if (typeof value !== 'string') {
    return null
  }

  const matches = [
    ...(value.match(/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/gu) ?? []),
    ...(value.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gu) ?? []),
  ]
  const candidates = matches.length > 0 ? matches : [value]

  for (const candidate of [...candidates].reverse()) {
    const parsed = parseSingleDate(candidate)
    if (parsed) {
      return parsed
    }
  }

  return null
}

const toMonthOfQuarterIndex = (value: unknown) => {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  return normalized === 'first' ||
    normalized === 'second' ||
    normalized === 'third'
    ? MONTH_OF_QUARTER_INDEX[normalized]
    : null
}

const deriveCollectedBillingMonthMMYY = (
  normalized: JsonRecord,
  periodEndFallback: string | null,
) => {
  const periodEnd =
    extractPeriodEndDate(normalized.periodEnd) ??
    extractPeriodEndDate(normalized.periodCovered) ??
    extractPeriodEndDate(periodEndFallback)
  if (!periodEnd) {
    return null
  }

  const monthOfQuarterIndex = toMonthOfQuarterIndex(normalized.monthOfQuarter)
  const billingMonthIndex =
    monthOfQuarterIndex === null
      ? periodEnd.monthIndex
      : Math.floor(periodEnd.monthIndex / 3) * 3 + monthOfQuarterIndex
  if (billingMonthIndex < 0 || billingMonthIndex > 11) {
    return null
  }

  return `${String(billingMonthIndex + 1).padStart(2, '0')}${String(
    periodEnd.year,
  ).slice(-2)}`
}

const cloneStylePart = <T>(value: T): T => {
  if (value === null || value === undefined) {
    return value
  }

  return JSON.parse(JSON.stringify(value)) as T
}

const cloneTemplateCellStyle = (
  worksheet: ExcelJS.Worksheet,
  templateRowNumber: number,
  targetRowNumber: number,
  columnNumber: number,
) => {
  const templateCell = worksheet.getCell(templateRowNumber, columnNumber)
  const targetCell = worksheet.getCell(targetRowNumber, columnNumber)

  targetCell.style = cloneStylePart(templateCell.style)
}

const mapRecordToView = (
  record: typeof reconciliationResults.$inferSelect,
): ReconciliationRowView => ({
  id: record.id,
  uploadBatchId: record.uploadBatchId,
  salesReportId: record.salesReportId,
  salesReportVersionId: record.salesReportVersionId,
  salesReportRunId: record.salesReportRunId,
  salesReportRowId: record.salesReportRowId,
  matchedUploadBatchId: record.matchedUploadBatchId,
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
  matchedCertificateId: record.matchedCertificateId,
  taxBase: record.taxBase === null ? null : roundMoney(record.taxBase),
  taxWithheld:
    record.taxWithheld === null ? null : roundMoney(record.taxWithheld),
  taxBaseDifference: roundMoney(record.taxBaseDifference),
  taxWithheldDifference: roundMoney(record.taxWithheldDifference),
  hasDifference: record.hasDifference,
  matchStatus: record.matchStatus as ReconciliationRowView['matchStatus'],
  matchedAt: record.matchedAt?.toISOString() ?? null,
  emailSentAt: record.emailSentAt?.toISOString() ?? null,
  archivedAt: record.archivedAt?.toISOString() ?? null,
  daysUncollected:
    record.matchStatus === 'matched' && !record.matchedAt
      ? null
      : calculateDaysUncollected({
          emailSentAt: record.emailSentAt,
          matchedAt: record.matchedAt,
        }),
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
})

export const mapViewToWorkbookRow = (
  row: ReconciliationRowView,
): ReconciliationWorkbookRow => ({
  shortName: row.issuerShortnameUsedForMatch,
  tin: row.tin,
  customerName: row.customerName,
  invoiceNumber: row.invoiceNumber,
  billingMonthMMYY: row.derivedBillingMonthMMYY,
  accountingDate: row.accountingDate,
  taxableSales: row.taxableSales,
  prepaidCWT: row.prepaidCWT,
  collectedTaxBase: row.taxBase ?? 0,
  collectedPrepaidCWT: row.taxWithheld ?? 0,
  taxBaseDifference: row.taxBaseDifference,
  prepaidCWTDifference: row.taxWithheldDifference,
})

const buildQuarterMonths = (quarterKey: string) => {
  const match = quarterKey.match(/^(\d{4})-Q([1-4])$/)
  if (!match) {
    return []
  }

  const fullYear = Number.parseInt(match[1], 10)
  const quarter = Number.parseInt(match[2], 10)
  const startMonth = (quarter - 1) * 3 + 1
  const shortYear = String(fullYear).slice(-2)

  return [startMonth, startMonth + 1, startMonth + 2].map(
    (month) => `${String(month).padStart(2, '0')}${shortYear}`,
  )
}

const buildAnnualMonths = (annualKey: string) => {
  const match = annualKey.match(/^\d{4}$/)
  if (!match) {
    return []
  }

  const shortYear = annualKey.slice(-2)

  return Array.from(
    { length: 12 },
    (_, index) => `${String(index + 1).padStart(2, '0')}${shortYear}`,
  )
}

const buildExportBillingMonths = (
  granularity: ReconciliationExportGranularity,
  periodValue: string,
) =>
  granularity === 'monthly'
    ? [periodValue]
    : granularity === 'quarterly'
      ? buildQuarterMonths(periodValue)
      : buildAnnualMonths(periodValue)

const matchesCustomerNameFilter = (
  candidate: CollectedTaxRecordExportCandidate,
  customerName?: string | null,
) => {
  const trimmed = customerName?.trim()
  if (!trimmed) {
    return true
  }

  const normalizedNeedle = trimmed.toLowerCase()
  const normalizedShortNameNeedle = normalizeIssuerShortname(trimmed)
  const haystack = [
    candidate.metadata.issuerShortname,
    candidate.metadata.normalizedIssuerShortname,
    candidate.metadata.recipientShortname,
    candidate.fileName,
    candidate.payeeName,
    candidate.payorName,
  ].filter((value): value is string => Boolean(value))

  return haystack.some((value) => {
    const normalizedValue = value.toLowerCase()
    return (
      normalizedValue.includes(normalizedNeedle) ||
      (normalizedShortNameNeedle.length > 0 &&
        normalizeIssuerShortname(value).includes(normalizedShortNameNeedle))
    )
  })
}

export const filterCollectedOnlyTaxRecordCandidates = (
  candidates: Array<CollectedTaxRecordExportCandidate>,
  matchedCertificateIds: Set<number>,
  options: {
    billingMonths?: Array<string>
    customerName?: string | null
  },
) => {
  const billingMonths = options.billingMonths
    ? new Set(options.billingMonths)
    : null

  return candidates.filter(
    (candidate) =>
      !matchedCertificateIds.has(candidate.taxRecordId) &&
      (!billingMonths ||
        billingMonths.has(candidate.metadata.billingMonthMMYY)) &&
      matchesCustomerNameFilter(candidate, options.customerName),
  )
}

const mapCollectedCandidateToWorkbookRow = (
  candidate: CollectedTaxRecordExportCandidate,
): ReconciliationWorkbookRow => ({
  shortName: null,
  tin: null,
  customerName: null,
  invoiceNumber: null,
  billingMonthMMYY: candidate.metadata.billingMonthMMYY,
  accountingDate: null,
  taxableSales: null,
  prepaidCWT: null,
  collectedTaxBase: candidate.taxBase,
  collectedPrepaidCWT: candidate.taxWithheld,
  taxBaseDifference: candidate.taxBase,
  prepaidCWTDifference: candidate.taxWithheld,
})

const buildIntakeMetadata = (row: {
  certificateDocumentType: string | null
  certificateIssuerShortName: string | null
  certificateIssuerShortNameNormalized: string | null
  certificateRecipientShortName: string | null
  certificateSettlementReferenceNumber: string | null
  certificateBillingMonthMMYY: string | null
  certificateDateUploaded: string | null
}) => {
  const normalizedIssuerShortname =
    row.certificateIssuerShortNameNormalized ??
    normalizeIssuerShortname(row.certificateIssuerShortName ?? '')

  if (
    !row.certificateDocumentType ||
    !row.certificateBillingMonthMMYY ||
    !normalizedIssuerShortname
  ) {
    return null
  }

  return {
    documentType: row.certificateDocumentType,
    issuerShortname:
      row.certificateIssuerShortName ??
      row.certificateIssuerShortNameNormalized ??
      '',
    normalizedIssuerShortname,
    recipientShortname: row.certificateRecipientShortName ?? '',
    settlementReferenceNumber: row.certificateSettlementReferenceNumber ?? '',
    billingMonthMMYY: row.certificateBillingMonthMMYY,
    dateUploaded: row.certificateDateUploaded ?? '',
  } satisfies ParsedCertificateFileMetadata
}

const buildDocumentResultMetadata = (
  row: {
    periodEnd: string | null
    monthOfQuarter: string | null
    payeeName: string | null
    payeeShortName: string | null
    payorName: string | null
    payorShortName: string | null
  },
  normalized: JsonRecord,
  amounts: {
    taxBase: number | null
    taxWithheld: number | null
  },
): ParsedCertificateFileMetadata | null => {
  if (amounts.taxBase === null && amounts.taxWithheld === null) {
    return null
  }

  const issuerShortname =
    toText(row.payorShortName) ??
    toText(normalized.payorShortName) ??
    toText(row.payorName) ??
    toText(normalized.payorName)
  const normalizedIssuerShortname = normalizeIssuerShortname(
    issuerShortname ?? '',
  )
  const billingMonthMMYY = deriveCollectedBillingMonthMMYY(
    normalized,
    row.periodEnd,
  )

  if (!normalizedIssuerShortname || !billingMonthMMYY) {
    return null
  }

  const recipientShortname =
    toText(row.payeeShortName) ??
    toText(normalized.payeeShortName) ??
    normalizeIssuerShortname(
      toText(row.payeeName) ?? toText(normalized.payeeName) ?? '',
    )

  return {
    documentType: 'BIR2307',
    issuerShortname: issuerShortname ?? normalizedIssuerShortname,
    normalizedIssuerShortname,
    recipientShortname,
    settlementReferenceNumber: '',
    billingMonthMMYY,
    dateUploaded: '',
  }
}

export const buildCollectedTaxRecordExportCandidate = (row: {
  taxRecordId: number
  batchId: string
  sourceFileId: string
  fileName: string
  resultCreatedAt: Date
  taxBase: string | null
  taxWithheld: string | null
  periodEnd: string | null
  monthOfQuarter: string | null
  payeeName: string | null
  payeeShortName: string | null
  payorName: string | null
  payorShortName: string | null
  certificateDocumentType: string | null
  certificateIssuerShortName: string | null
  certificateIssuerShortNameNormalized: string | null
  certificateRecipientShortName: string | null
  certificateSettlementReferenceNumber: string | null
  certificateBillingMonthMMYY: string | null
  certificateDateUploaded: string | null
}) => {
  const fileName = row.fileName
  const normalized = {
    taxBase: row.taxBase,
    taxWithheld: row.taxWithheld,
    periodEnd: row.periodEnd,
    monthOfQuarter: row.monthOfQuarter,
    payeeName: row.payeeName,
    payeeShortName: row.payeeShortName,
    payorName: row.payorName,
    payorShortName: row.payorShortName,
  }
  const taxBase = toNumberValue(row.taxBase)
  const taxWithheld = toNumberValue(row.taxWithheld)
  const metadata =
    buildIntakeMetadata(row) ??
    parseCertificateFileName(fileName) ??
    buildDocumentResultMetadata(row, normalized, { taxBase, taxWithheld })

  if (!metadata || !isBir2307Metadata(metadata)) {
    return null
  }

  return {
    taxRecordId: row.taxRecordId,
    batchId: row.batchId,
    sourceFileId: row.sourceFileId,
    fileName,
    resultCreatedAt: row.resultCreatedAt,
    taxBase,
    taxWithheld,
    metadata,
    payeeName: toText(row.payeeName) ?? toText(normalized.payeeName),
    payorName: toText(row.payorName) ?? toText(normalized.payorName),
  } satisfies CollectedTaxRecordExportCandidate
}

const buildLatestCollectedCandidates = (
  rows: Array<{
    taxRecordId: number
    batchId: string
    sourceFileId: string
    fileName: string
    resultCreatedAt: Date
    taxBase: string | null
    taxWithheld: string | null
    periodEnd: string | null
    monthOfQuarter: string | null
    payeeName: string | null
    payeeShortName: string | null
    payorName: string | null
    payorShortName: string | null
    certificateDocumentType: string | null
    certificateIssuerShortName: string | null
    certificateIssuerShortNameNormalized: string | null
    certificateRecipientShortName: string | null
    certificateSettlementReferenceNumber: string | null
    certificateBillingMonthMMYY: string | null
    certificateDateUploaded: string | null
  }>,
) => {
  const latestByCertificateId = new Map<
    string,
    CollectedTaxRecordExportCandidate
  >()

  for (const row of rows) {
    const certificateId = String(row.taxRecordId)
    if (latestByCertificateId.has(certificateId)) {
      continue
    }

    const candidate = buildCollectedTaxRecordExportCandidate(row)
    if (candidate) {
      latestByCertificateId.set(certificateId, candidate)
    }
  }

  return Array.from(latestByCertificateId.values())
}

export const buildReconciliationWorkbook = async (
  rows: Array<ReconciliationRowView>,
) => buildReconciliationWorkbookFromRows(rows.map(mapViewToWorkbookRow))

export const buildReconciliationWorkbookFromRows = async (
  rows: Array<ReconciliationWorkbookRow>,
) => {
  if (rows.length === 0) {
    return Buffer.alloc(0)
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    Buffer.from(RECONCILIATION_ATTACHMENT_TEMPLATE_BASE64, 'base64') as never,
  )
  const worksheet = workbook.getWorksheet(RECON_ATTACHMENT_SHEET_NAME)

  if (!worksheet) {
    throw new Error('Reconciliation attachment template sheet is missing.')
  }

  const templateRow = worksheet.getRow(RECON_DATA_START_ROW)

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const rowNumber = RECON_DATA_START_ROW + rowIndex
    const targetRow = worksheet.getRow(rowNumber)

    if (rowIndex > 0) {
      targetRow.height = templateRow.height

      for (
        let columnNumber = RECON_ATTACHMENT_RANGE_START_COLUMN;
        columnNumber <= RECON_ATTACHMENT_RANGE_END_COLUMN;
        columnNumber += 1
      ) {
        cloneTemplateCellStyle(
          worksheet,
          RECON_DATA_START_ROW,
          rowNumber,
          columnNumber,
        )
      }
    }
  }

  rows.forEach((row, index) => {
    const rowNumber = RECON_DATA_START_ROW + index
    worksheet.getCell(`B${rowNumber}`).value = row.shortName ?? ''
    worksheet.getCell(`C${rowNumber}`).value = formatTinForDisplay(
      row.tin ?? '',
    )
    worksheet.getCell(`D${rowNumber}`).value = row.customerName ?? ''
    worksheet.getCell(`E${rowNumber}`).value = row.invoiceNumber ?? ''
    worksheet.getCell(`F${rowNumber}`).value = formatBillingPeriod(
      row.billingMonthMMYY,
    )
    worksheet.getCell(`G${rowNumber}`).value = row.accountingDate ?? ''
    worksheet.getCell(`H${rowNumber}`).value = row.taxableSales ?? ''
    worksheet.getCell(`I${rowNumber}`).value = row.prepaidCWT ?? ''
    worksheet.getCell(`J${rowNumber}`).value = row.collectedTaxBase ?? ''
    worksheet.getCell(`K${rowNumber}`).value = row.collectedPrepaidCWT ?? ''
    worksheet.getCell(`L${rowNumber}`).value = row.taxBaseDifference ?? ''
    worksheet.getCell(`M${rowNumber}`).value = row.prepaidCWTDifference ?? ''
  })

  for (const cellAddress of ['B2', 'J2', 'L2']) {
    const cell = worksheet.getCell(cellAddress)
    cell.alignment = {
      ...cell.alignment,
      horizontal: 'center',
      vertical: 'middle',
    }
  }

  for (
    let rowNumber = RECON_ATTACHMENT_RANGE_START_ROW;
    rowNumber < RECON_DATA_START_ROW + rows.length;
    rowNumber += 1
  ) {
    for (
      let columnNumber = RECON_ATTACHMENT_RANGE_START_COLUMN;
      columnNumber <= RECON_ATTACHMENT_RANGE_END_COLUMN;
      columnNumber += 1
    ) {
      worksheet.getCell(rowNumber, columnNumber).border = THIN_BORDER
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export const buildReconciliationExportFileName = (
  granularity: ReconciliationExportGranularity,
  periodValue: string,
  options: { customerName?: string | null } = {},
) => {
  const suffix =
    granularity === 'monthly'
      ? formatBillingPeriod(periodValue)
      : granularity === 'quarterly'
        ? formatQuarterLabel(periodValue)
        : formatAnnualLabel(periodValue)
  const label =
    granularity === 'monthly'
      ? 'Monthly'
      : granularity === 'quarterly'
        ? 'Quarterly'
        : 'Annual'
  const customerFileNamePart =
    options.customerName
      ?.trim()
      .replaceAll(/[^a-zA-Z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '')
      .slice(0, 60) ?? ''
  const customerSuffix = customerFileNamePart ? `-${customerFileNamePart}` : ''

  return `Reconciliation-Report-${label}-${suffix.replaceAll(/\s+/g, '-')}${customerSuffix}.xlsx`
}

export const buildBatchReconciliationExportFileName = (uploadBatchId: string) =>
  `Reconciliation-Report-Batch-${uploadBatchId.slice(0, 8)}.xlsx`

const buildSalesReportReconciliationExportFileName = (reportName: string) => {
  const reportFileNamePart =
    reportName
      .trim()
      .replaceAll(/[^a-zA-Z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '')
      .slice(0, 60) || 'Sales-Report'

  return `Reconciliation-Report-${reportFileNamePart}-All.xlsx`
}

const buildReportEntityConditions = async (entityId?: string | null) => {
  if (!entityId) {
    return {}
  }

  const entityFilter = await resolveEntityScopeFilterById(entityId)
  if (!entityFilter) {
    return {}
  }

  const candidates = [entityFilter.shortName, entityFilter.companyName]
    .map((value) => normalizeIssuerShortname(value ?? ''))
    .filter(Boolean)

  return {
    reconciliationCondition: or(
      eq(salesReports.entityId, entityFilter.id),
      ...candidates.map(
        (candidate) =>
          sql`upper(trim(coalesce(${reconciliationResults.requestingEntityShortName}, ''))) = ${candidate}`,
      ),
    ),
    salesReportCondition: eq(salesReports.entityId, entityFilter.id),
  } satisfies {
    reconciliationCondition?: SQL
    salesReportCondition?: SQL
  }
}

const fetchMatchedTaxRecordIds = async (
  taxRecordIds: Array<number>,
): Promise<Set<number>> => {
  if (taxRecordIds.length === 0) {
    return new Set()
  }

  const db = getDb()
  const rows = await db
    .select({ taxRecordId: reconciliationResultCollections.certificateId })
    .from(reconciliationResultCollections)
    .innerJoin(
      reconciliationResults,
      eq(
        reconciliationResultCollections.reconciliationResultId,
        reconciliationResults.id,
      ),
    )
    .where(
      and(
        isNull(reconciliationResultCollections.archivedAt),
        isNull(reconciliationResults.archivedAt),
        inArray(reconciliationResultCollections.certificateId, taxRecordIds),
      ),
    )

  return new Set(rows.map((row) => row.taxRecordId))
}

const fetchCollectedTaxRecordCandidates = async (options: {
  salesReportCondition?: SQL
}) => {
  const db = getDb()
  const rows = await db
    .select({
      taxRecordId: certificateResults.id,
      batchId: certificateResults.batchId,
      sourceFileId: certificateResults.sourceFileId,
      fileName: intakeFiles.originalFileName,
      resultCreatedAt: certificateResults.createdAt,
      taxBase: certificateResults.totalTaxBase,
      taxWithheld: certificateResults.totalTaxWithheld,
      periodEnd: certificateResults.periodEnd,
      monthOfQuarter: certificateResults.monthOfQuarter,
      payeeName: certificateResults.payeeName,
      payeeShortName: certificateResults.payeeShortName,
      payorName: certificateResults.payorName,
      payorShortName: certificateResults.payorShortName,
      certificateDocumentType: intakeFiles.certificateDocumentType,
      certificateIssuerShortName: intakeFiles.certificateIssuerShortName,
      certificateIssuerShortNameNormalized:
        intakeFiles.certificateIssuerShortNameNormalized,
      certificateRecipientShortName: intakeFiles.certificateRecipientShortName,
      certificateSettlementReferenceNumber:
        intakeFiles.certificateSettlementReferenceNumber,
      certificateBillingMonthMMYY: intakeFiles.certificateBillingMonthMMYY,
      certificateDateUploaded: intakeFiles.certificateDateUploaded,
    })
    .from(certificateResults)
    .innerJoin(intakeFiles, eq(certificateResults.uploadId, intakeFiles.id))
    .innerJoin(
      salesReportRunBatches,
      eq(intakeFiles.batchId, salesReportRunBatches.batchId),
    )
    .innerJoin(
      salesReportRuns,
      eq(salesReportRunBatches.salesReportRunId, salesReportRuns.id),
    )
    .innerJoin(salesReports, eq(salesReportRuns.salesReportId, salesReports.id))
    .where(
      and(
        eq(certificateResults.status, 'accepted'),
        isNull(intakeFiles.removedFromBatchAt),
        isNull(intakeFiles.purgeStatus),
        isNull(salesReportRuns.archivedAt),
        options.salesReportCondition,
      ),
    )
    .orderBy(desc(certificateResults.createdAt), desc(certificateResults.id))

  return buildLatestCollectedCandidates(rows)
}

const fetchCollectedTaxRecordCandidatesForReport = async (
  salesReportId: string,
) =>
  fetchCollectedTaxRecordCandidates({
    salesReportCondition: eq(salesReports.id, salesReportId),
  })

export const exportReconciliationReport = async (
  granularity: ReconciliationExportGranularity,
  periodValue: string,
  options: {
    entityId?: string | null
    customerName?: string | null
  } = {},
) => {
  const db = getDb()
  const entityConditions = await buildReportEntityConditions(options.entityId)
  const customerNameCondition = buildReconciliationCustomerNameCondition(
    options.customerName,
  )
  const billingMonths = buildExportBillingMonths(granularity, periodValue)
  const periodCondition =
    granularity === 'monthly'
      ? eq(reconciliationResults.derivedBillingMonthMMYY, periodValue)
      : granularity === 'quarterly'
        ? inArray(
            reconciliationResults.derivedBillingMonthMMYY,
            buildQuarterMonths(periodValue),
          )
        : inArray(
            reconciliationResults.derivedBillingMonthMMYY,
            buildAnnualMonths(periodValue),
          )
  const whereCondition = and(
    periodCondition,
    isNull(reconciliationResults.archivedAt),
    entityConditions.reconciliationCondition,
    customerNameCondition,
  )

  const rows = (
    await db
      .select({ result: reconciliationResults })
      .from(reconciliationResults)
      .leftJoin(
        salesReports,
        eq(reconciliationResults.salesReportId, salesReports.id),
      )
      .where(whereCondition)
      .orderBy(
        desc(reconciliationResults.createdAt),
        desc(reconciliationResults.id),
      )
  ).map((row) => row.result)

  const collectedCandidates = await fetchCollectedTaxRecordCandidates({
    salesReportCondition: entityConditions.salesReportCondition,
  })
  const matchedCertificateIds = await fetchMatchedTaxRecordIds(
    collectedCandidates.map((candidate) => candidate.taxRecordId),
  )
  const collectedOnlyRows = filterCollectedOnlyTaxRecordCandidates(
    collectedCandidates,
    matchedCertificateIds,
    {
      billingMonths,
      customerName: options.customerName,
    },
  ).map(mapCollectedCandidateToWorkbookRow)
  const workbookRows = [
    ...rows.map((row) => mapViewToWorkbookRow(mapRecordToView(row))),
    ...collectedOnlyRows,
  ]

  if (workbookRows.length === 0) {
    throw new Error(
      'No reconciliation rows found for the selected export period.',
    )
  }

  const content = await buildReconciliationWorkbookFromRows(workbookRows)

  return {
    fileName: buildReconciliationExportFileName(granularity, periodValue, {
      customerName: options.customerName,
    }),
    content,
  }
}

export const exportSalesReportReconciliationReport = async (
  salesReportId: string,
) => {
  const db = getDb()
  const reportRows = await db
    .select({ id: salesReports.id, name: salesReports.name })
    .from(salesReports)
    .where(
      and(eq(salesReports.id, salesReportId), isNull(salesReports.deletedAt)),
    )
    .limit(1)
  const report = reportRows.at(0)

  if (!report) {
    throw new Error('Sales report not found.')
  }

  const rows = (
    await db
      .select({ result: reconciliationResults })
      .from(reconciliationResults)
      .where(
        and(
          eq(reconciliationResults.salesReportId, salesReportId),
          isNull(reconciliationResults.archivedAt),
        ),
      )
      .orderBy(
        desc(reconciliationResults.createdAt),
        desc(reconciliationResults.id),
      )
  ).map((row) => row.result)

  const collectedCandidates =
    await fetchCollectedTaxRecordCandidatesForReport(salesReportId)
  const matchedCertificateIds = await fetchMatchedTaxRecordIds(
    collectedCandidates.map((candidate) => candidate.taxRecordId),
  )
  const collectedOnlyRows = filterCollectedOnlyTaxRecordCandidates(
    collectedCandidates,
    matchedCertificateIds,
    {},
  ).map(mapCollectedCandidateToWorkbookRow)
  const workbookRows = [
    ...rows.map((row) => mapViewToWorkbookRow(mapRecordToView(row))),
    ...collectedOnlyRows,
  ]

  if (workbookRows.length === 0) {
    throw new Error('No reconciliation rows found for this sales report.')
  }

  const content = await buildReconciliationWorkbookFromRows(workbookRows)

  return {
    fileName: buildSalesReportReconciliationExportFileName(report.name),
    content,
  }
}

export const exportBatchReconciliationReport = async (
  uploadBatchId: string,
) => {
  const db = getDb()
  const rows = await db
    .select()
    .from(reconciliationResults)
    .where(
      and(
        eq(reconciliationResults.uploadBatchId, uploadBatchId),
        isNull(reconciliationResults.archivedAt),
      ),
    )
    .orderBy(
      desc(reconciliationResults.createdAt),
      desc(reconciliationResults.id),
    )

  if (rows.length === 0) {
    throw new Error('No reconciliation rows found for this upload batch.')
  }

  const content = await buildReconciliationWorkbook(rows.map(mapRecordToView))

  return {
    fileName: buildBatchReconciliationExportFileName(uploadBatchId),
    content,
  }
}

export const isValidReconciliationExportPeriod = (
  granularity: ReconciliationExportGranularity,
  periodValue: string,
) => {
  if (granularity === 'monthly') {
    return parseBillingMonthMMYY(periodValue) !== null
  }

  if (granularity === 'quarterly') {
    const quarterMonths = buildQuarterMonths(periodValue)

    return (
      quarterMonths.length === 3 &&
      getQuarterFromBillingMonth(quarterMonths[0]) !== null
    )
  }

  return buildAnnualMonths(periodValue).length === 12
}
