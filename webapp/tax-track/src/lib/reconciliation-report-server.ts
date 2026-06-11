import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'
import { normalizeIssuerShortname } from '@taxtrack/shared'

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
import { reconciliationResults, salesReports } from '@/lib/schema'

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
  matchedTaxRecordId: record.matchedTaxRecordId,
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

export const buildReconciliationWorkbook = async (
  rows: Array<ReconciliationRowView>,
) => {
  if (rows.length === 0) {
    return Buffer.alloc(0)
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    Buffer.from(RECONCILIATION_ATTACHMENT_TEMPLATE_BASE64, 'base64'),
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
    worksheet.getCell(`B${rowNumber}`).value = row.issuerShortnameUsedForMatch
    worksheet.getCell(`C${rowNumber}`).value = formatTinForDisplay(row.tin)
    worksheet.getCell(`D${rowNumber}`).value = row.customerName
    worksheet.getCell(`E${rowNumber}`).value = row.invoiceNumber
    worksheet.getCell(`F${rowNumber}`).value = formatBillingPeriod(
      row.derivedBillingMonthMMYY,
    )
    worksheet.getCell(`G${rowNumber}`).value = row.accountingDate ?? ''
    worksheet.getCell(`H${rowNumber}`).value = row.taxableSales
    worksheet.getCell(`I${rowNumber}`).value = row.prepaidCWT
    worksheet.getCell(`J${rowNumber}`).value = row.taxBase ?? 0
    worksheet.getCell(`K${rowNumber}`).value = row.taxWithheld ?? 0
    worksheet.getCell(`L${rowNumber}`).value = row.taxBaseDifference
    worksheet.getCell(`M${rowNumber}`).value = row.taxWithheldDifference
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
  const customerSuffix = customerFileNamePart
    ? `-${customerFileNamePart}`
    : ''

  return `Reconciliation-Report-${label}-${suffix.replaceAll(/\s+/g, '-')}${customerSuffix}.xlsx`
}

export const buildBatchReconciliationExportFileName = (uploadBatchId: string) =>
  `Reconciliation-Report-Batch-${uploadBatchId.slice(0, 8)}.xlsx`

const buildReportEntityCondition = async (entityId?: string | null) => {
  if (!entityId) {
    return undefined
  }

  const entityFilter = await resolveEntityScopeFilterById(entityId)
  if (!entityFilter) {
    return undefined
  }

  const candidates = [entityFilter.shortName, entityFilter.companyName]
    .map((value) => normalizeIssuerShortname(value ?? ''))
    .filter(Boolean)

  return or(
    eq(salesReports.entityId, entityFilter.id),
    ...candidates.map(
      (candidate) =>
        sql`upper(trim(coalesce(${reconciliationResults.requestingEntityShortName}, ''))) = ${candidate}`,
    ),
  )
}

export const exportReconciliationReport = async (
  granularity: ReconciliationExportGranularity,
  periodValue: string,
  options: {
    entityId?: string | null
    customerName?: string | null
  } = {},
) => {
  const db = getDb()
  const entityCondition = await buildReportEntityCondition(options.entityId)
  const customerNameCondition = buildReconciliationCustomerNameCondition(
    options.customerName,
  )
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
    entityCondition,
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

  if (rows.length === 0) {
    throw new Error(
      'No reconciliation rows found for the selected export period.',
    )
  }

  const content = await buildReconciliationWorkbook(rows.map(mapRecordToView))

  return {
    fileName: buildReconciliationExportFileName(granularity, periodValue, {
      customerName: options.customerName,
    }),
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
