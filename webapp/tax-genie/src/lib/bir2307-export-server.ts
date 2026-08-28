import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { formatTinForDisplay } from '@taxgenie/shared/utils/tin'

import { BIR_2307_EXPORT_TEMPLATE_BASE64 } from '@/lib/bir2307-export-template'
import { getDb } from '@/lib/db'
import {
  certificateResults,
  certificateTaxRows,
  documentResults,
  intakeFiles,
} from '@/lib/schema'

const SHEET_NAME = 'Sheet1'
const DATA_START_ROW = 4
const FIRST_COLUMN = 1
const LAST_COLUMN = 18
const TEMPLATE_SAMPLE_END_ROW = 14
const ADDRESS_COLUMN_WIDTH = 32
const TEMPLATE_HEADER_MERGES = [
  'A1:O1',
  'B2:E2',
  'F2:M2',
  'N2:N3',
  'O2:O3',
] as const
const EXPORT_HEADER_MERGES = [
  'A1:R1',
  'B2:F2',
  'G2:P2',
  'Q2:Q3',
  'R2:R3',
] as const
const EXPORT_COLUMN_HEADERS = [
  'Period',
  'Name',
  'TIN',
  'Address',
  'With address?',
  'With zip code?',
  'Name',
  'TIN',
  'Address',
  'With address?',
  'With zip code?',
  'With Printed Name',
  'With Signature',
  'ATC(s)',
  'EWT/CWT Tax Base',
  'EWT/CWT Tax Withheld',
  'Duplicate or Unique?',
  'Condition',
] as const
const THIN_BORDER = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
} as const
const GOOD_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFC6EFCE' },
} as const
const ERROR_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFC7CE' },
} as const
const PERIOD_COLUMN_INDEX = 0
const PAYEE_TIN_COLUMN_INDEX = 2
const PAYOR_TIN_COLUMN_INDEX = 7
const TAX_BASE_COLUMN_INDEX = 14
const TAX_WITHHELD_COLUMN_INDEX = 15
const CONDITION_COLUMN_INDEX = 17
const MONTH_NAMES = [
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
const MONTH_OF_QUARTER_INDEX = {
  first: 0,
  second: 1,
  third: 2,
} as const
const MULTIPLE_CERTIFICATE_REASON_CODES = new Set([
  'multiple_certificates_detected',
  'multiple_certificate_pages_detected',
])

export type Bir2307ExportRow = {
  period: string | null
  payeeName: string | null
  payeeTin: string | null
  payeeAddress: string | null
  payeeHasAddress: 'Yes' | 'No' | null
  payeeHasZip: 'Yes' | 'No' | null
  payorName: string | null
  payorTin: string | null
  payorAddress: string | null
  payorHasAddress: 'Yes' | 'No' | null
  payorHasZip: 'Yes' | 'No' | null
  hasPrintedName: 'Yes' | 'No' | null
  hasSignature: 'Yes' | 'No' | null
  atcCode: string | null
  taxBase: number | null
  taxWithheld: number | null
  duplicateStatus: 'DUPLICATE' | 'UNIQUE' | 'UNKNOWN'
  condition: 'GOOD' | 'ERROR'
}

export type Bir2307AtcDetailRow = {
  certificateId: number
  certificateKey: string
  fileName: string
  period: string | null
  payeeName: string | null
  payeeTin: string | null
  payorName: string | null
  payorTin: string | null
  pageNumber: number
  lineNumber: number
  atcCode: string | null
  description: string | null
  firstMonthAmount: number | null
  secondMonthAmount: number | null
  thirdMonthAmount: number | null
  taxBase: number | null
  taxRate: number | null
  taxWithheld: number | null
}

type CertificateResultRecord = typeof certificateResults.$inferSelect
type CertificateTaxRowRecord = typeof certificateTaxRows.$inferSelect

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

const getWorksheetMergeRanges = (worksheet: ExcelJS.Worksheet) =>
  (
    worksheet as unknown as {
      model?: {
        merges?: Array<string>
      }
    }
  ).model?.merges ?? []

const hasCellData = (value: unknown) =>
  value !== null && value !== undefined && value !== ''

const clearCellPresentation = (cell: ExcelJS.Cell) => {
  cell.style = cloneStylePart(cell.style)
  cell.border = {}
  cell.fill = undefined as unknown as ExcelJS.Fill
}

const clearRowPresentation = (row: ExcelJS.Row) => {
  row.border = {}
  row.fill = undefined as unknown as ExcelJS.Fill
}

const toText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

const toTinText = (value: unknown): string | null => {
  const text = formatTinForDisplay(value)

  return text || null
}

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100) / 100
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/gu, ''))
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null
  }

  return null
}

const toRate = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const parseDateParts = (
  year: number,
  month: number,
  day: number,
): Date | null => {
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

  return parsed
}

const parseSingleDate = (value: string): Date | null => {
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

export const parseBir2307Period = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
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

const formatMonthYear = (year: number, monthIndex: number) => {
  if (monthIndex < 0 || monthIndex >= MONTH_NAMES.length) {
    return null
  }

  return `${MONTH_NAMES[monthIndex]} ${year}`
}

const formatBir2307PeriodLabel = (
  periodEnd: Date | null,
  monthOfQuarter: unknown,
) => {
  if (!periodEnd) {
    return null
  }

  const year = periodEnd.getFullYear()
  const periodEndMonthIndex = periodEnd.getMonth()
  const monthOfQuarterIndex = toMonthOfQuarterIndex(monthOfQuarter)
  if (monthOfQuarterIndex === null) {
    return formatMonthYear(year, periodEndMonthIndex)
  }

  const quarterStartMonthIndex = Math.floor(periodEndMonthIndex / 3) * 3
  return formatMonthYear(year, quarterStartMonthIndex + monthOfQuarterIndex)
}

const buildErrorFallbackExportRow = (): Bir2307ExportRow => ({
  period: null,
  payeeName: null,
  payeeTin: null,
  payeeAddress: null,
  payeeHasAddress: null,
  payeeHasZip: null,
  payorName: null,
  payorTin: null,
  payorAddress: null,
  payorHasAddress: null,
  payorHasZip: null,
  hasPrintedName: null,
  hasSignature: null,
  atcCode: null,
  taxBase: null,
  taxWithheld: null,
  duplicateStatus: 'UNIQUE',
  condition: 'ERROR',
})

export const mapCertificateResultToBir2307Row = (
  record: CertificateResultRecord,
  taxRows: Array<CertificateTaxRowRecord> = [],
): Bir2307ExportRow => {
  const duplicate = record.status === 'duplicate'
  const multipleCertificatesDetected = record.reasonCodes.some((reason) =>
    MULTIPLE_CERTIFICATE_REASON_CODES.has(reason),
  )
  const periodEnd = parseBir2307Period(record.periodEnd)
  return {
    period: formatBir2307PeriodLabel(periodEnd, record.monthOfQuarter),
    payeeName: toText(record.payeeName),
    payeeTin: toTinText(record.payeeTin),
    payeeAddress: toText(record.payeeAddress),
    payeeHasAddress: record.payeeAddress?.trim() ? 'Yes' : 'No',
    payeeHasZip: record.payeeZip?.trim() ? 'Yes' : 'No',
    payorName: toText(record.payorName),
    payorTin: toTinText(record.payorTin),
    payorAddress: toText(record.payorAddress),
    payorHasAddress: record.payorAddress?.trim() ? 'Yes' : 'No',
    payorHasZip: record.payorZip?.trim() ? 'Yes' : 'No',
    hasPrintedName: record.signerPrintedName?.trim() ? 'Yes' : 'No',
    hasSignature: record.signaturePresent ? 'Yes' : 'No',
    atcCode:
      Array.from(
        new Set(
          taxRows.flatMap((row) => {
            const code = toText(row.atcCode)
            return code ? [code] : []
          }),
        ),
      ).join(', ') || toText(record.primaryAtcCode),
    taxBase: toNumber(record.totalTaxBase),
    taxWithheld: toNumber(record.totalTaxWithheld),
    duplicateStatus: multipleCertificatesDetected
      ? 'UNKNOWN'
      : duplicate
        ? 'DUPLICATE'
        : 'UNIQUE',
    condition: record.status === 'error' ? 'ERROR' : 'GOOD',
  }
}

export const buildBir2307ExportRows = (
  records: Array<CertificateResultRecord>,
  missingActiveFileCount = 0,
  taxRows: Array<CertificateTaxRowRecord> = [],
): Array<Bir2307ExportRow> => {
  const taxRowsByCertificateId = new Map<
    number,
    Array<CertificateTaxRowRecord>
  >()
  for (const taxRow of taxRows) {
    const current = taxRowsByCertificateId.get(taxRow.certificateId) ?? []
    current.push(taxRow)
    taxRowsByCertificateId.set(taxRow.certificateId, current)
  }

  return [
    ...records.map((record) =>
      mapCertificateResultToBir2307Row(
        record,
        taxRowsByCertificateId.get(record.id) ?? [],
      ),
    ),
    ...Array.from({ length: Math.max(0, missingActiveFileCount) }, () =>
      buildErrorFallbackExportRow(),
    ),
  ]
}

export const buildBir2307AtcDetailRows = (
  records: Array<CertificateResultRecord>,
  taxRows: Array<CertificateTaxRowRecord>,
): Array<Bir2307AtcDetailRow> => {
  const recordById = new Map(records.map((record) => [record.id, record]))

  return taxRows.flatMap((taxRow) => {
    const record = recordById.get(taxRow.certificateId)
    if (!record) return []

    return [
      {
        certificateId: record.id,
        certificateKey: record.certificateKey,
        fileName: record.originalFileName,
        period: formatBir2307PeriodLabel(
          parseBir2307Period(record.periodEnd),
          record.monthOfQuarter,
        ),
        payeeName: toText(record.payeeName),
        payeeTin: toTinText(record.payeeTin),
        payorName: toText(record.payorName),
        payorTin: toTinText(record.payorTin),
        pageNumber: taxRow.pageNumber,
        lineNumber: taxRow.lineNumber,
        atcCode: toText(taxRow.atcCode),
        description: toText(taxRow.description),
        firstMonthAmount: toNumber(taxRow.firstMonthAmount),
        secondMonthAmount: toNumber(taxRow.secondMonthAmount),
        thirdMonthAmount: toNumber(taxRow.thirdMonthAmount),
        taxBase: toNumber(taxRow.taxBase),
        taxRate: toRate(taxRow.taxRate),
        taxWithheld: toNumber(taxRow.taxWithheld),
      },
    ]
  })
}

const applyStyleToCells = (
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  startColumn: number,
  endColumn: number,
  style: Partial<ExcelJS.Style>,
) => {
  for (
    let columnNumber = startColumn;
    columnNumber <= endColumn;
    columnNumber += 1
  ) {
    worksheet.getCell(rowNumber, columnNumber).style = cloneStylePart(style)
  }
}

const reflowTemplateHeaders = (worksheet: ExcelJS.Worksheet) => {
  const titleStyle = cloneStylePart(worksheet.getCell('A1').style)
  const payeeGroupStyle = cloneStylePart(worksheet.getCell('B2').style)
  const payorGroupStyle = cloneStylePart(worksheet.getCell('F2').style)
  const duplicateStyle = cloneStylePart(worksheet.getCell('N2').style)
  const conditionStyle = cloneStylePart(worksheet.getCell('O2').style)
  const headerStyle = cloneStylePart(worksheet.getCell('A3').style)
  const mergedRanges = getWorksheetMergeRanges(worksheet)

  TEMPLATE_HEADER_MERGES.forEach((range) => {
    if (mergedRanges.includes(range)) {
      worksheet.unMergeCells(range)
    }
  })

  worksheet.spliceColumns(4, 0, [])
  worksheet.spliceColumns(9, 0, [])
  worksheet.getColumn(4).width = ADDRESS_COLUMN_WIDTH
  worksheet.getColumn(9).width = ADDRESS_COLUMN_WIDTH

  for (
    let columnNumber = FIRST_COLUMN;
    columnNumber <= LAST_COLUMN;
    columnNumber += 1
  ) {
    worksheet.getCell(1, columnNumber).value = null
    worksheet.getCell(2, columnNumber).value = null
    worksheet.getCell(3, columnNumber).value = null
  }

  worksheet.getCell('A1').value = '2307 DETAILS'
  worksheet.getCell('B2').value = "Payee's Information"
  worksheet.getCell('G2').value = "Payor's Information"
  worksheet.getCell('Q2').value = 'Duplicate or Unique?'
  worksheet.getCell('R2').value = 'Condition'

  EXPORT_COLUMN_HEADERS.forEach((header, index) => {
    worksheet.getCell(3, FIRST_COLUMN + index).value = header
  })

  applyStyleToCells(worksheet, 1, FIRST_COLUMN, LAST_COLUMN, titleStyle)
  applyStyleToCells(worksheet, 2, 2, 6, payeeGroupStyle)
  applyStyleToCells(worksheet, 2, 7, 16, payorGroupStyle)
  worksheet.getCell('Q2').style = cloneStylePart(duplicateStyle)
  worksheet.getCell('Q3').style = cloneStylePart(duplicateStyle)
  worksheet.getCell('R2').style = cloneStylePart(conditionStyle)
  worksheet.getCell('R3').style = cloneStylePart(conditionStyle)
  applyStyleToCells(worksheet, 3, FIRST_COLUMN, LAST_COLUMN, headerStyle)
  worksheet.getCell('Q3').style = cloneStylePart(duplicateStyle)
  worksheet.getCell('R3').style = cloneStylePart(conditionStyle)

  EXPORT_HEADER_MERGES.forEach((range) => worksheet.mergeCells(range))
}

const clearTemplateSampleRows = (worksheet: ExcelJS.Worksheet) => {
  const endRow = Math.max(worksheet.actualRowCount, TEMPLATE_SAMPLE_END_ROW)
  for (let rowNumber = DATA_START_ROW; rowNumber <= endRow; rowNumber += 1) {
    clearRowPresentation(worksheet.getRow(rowNumber))

    for (
      let columnNumber = FIRST_COLUMN;
      columnNumber <= LAST_COLUMN;
      columnNumber += 1
    ) {
      const cell = worksheet.getCell(rowNumber, columnNumber)
      cell.value = null
      clearCellPresentation(cell)
    }
  }
}

const prepareDataRows = (worksheet: ExcelJS.Worksheet, rowCount: number) => {
  const templateRow = worksheet.getRow(DATA_START_ROW)

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowNumber = DATA_START_ROW + rowIndex
    const targetRow = worksheet.getRow(rowNumber)
    targetRow.height = templateRow.height

    if (rowIndex > 0) {
      for (
        let columnNumber = FIRST_COLUMN;
        columnNumber <= LAST_COLUMN;
        columnNumber += 1
      ) {
        cloneTemplateCellStyle(
          worksheet,
          DATA_START_ROW,
          rowNumber,
          columnNumber,
        )
      }
    }
  }
}

const writeRow = (
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  row: Bir2307ExportRow,
) => {
  const values = [
    row.period,
    row.payeeName,
    row.payeeTin,
    row.payeeAddress,
    row.payeeHasAddress ?? 'No',
    row.payeeHasZip ?? 'No',
    row.payorName,
    row.payorTin,
    row.payorAddress,
    row.payorHasAddress ?? 'No',
    row.payorHasZip ?? 'No',
    row.hasPrintedName ?? 'No',
    row.hasSignature ?? 'No',
    row.atcCode,
    row.taxBase,
    row.taxWithheld,
    row.duplicateStatus,
    row.condition,
  ]

  values.forEach((value, index) => {
    const cell = worksheet.getCell(rowNumber, FIRST_COLUMN + index)
    const cellValue =
      index === PAYEE_TIN_COLUMN_INDEX || index === PAYOR_TIN_COLUMN_INDEX
        ? toTinText(value)
        : value

    cell.value = hasCellData(cellValue) ? cellValue : null
    clearCellPresentation(cell)
    cell.border = THIN_BORDER

    if (index === PERIOD_COLUMN_INDEX) {
      cell.numFmt = '@'
    }

    if (
      index === TAX_BASE_COLUMN_INDEX ||
      index === TAX_WITHHELD_COLUMN_INDEX
    ) {
      cell.numFmt = '#,##0.00'
    }

    if (index === CONDITION_COLUMN_INDEX && hasCellData(cellValue)) {
      cell.fill = cellValue === 'GOOD' ? GOOD_FILL : ERROR_FILL
    }
  })
}

const ATC_DETAIL_COLUMNS = [
  { header: 'Certificate ID', key: 'certificateId', width: 16 },
  { header: 'Certificate Key', key: 'certificateKey', width: 24 },
  { header: 'File Name', key: 'fileName', width: 42 },
  { header: 'Period', key: 'period', width: 18 },
  { header: 'Payee Name', key: 'payeeName', width: 30 },
  { header: 'Payee TIN', key: 'payeeTin', width: 20 },
  { header: 'Payor Name', key: 'payorName', width: 30 },
  { header: 'Payor TIN', key: 'payorTin', width: 20 },
  { header: 'Page', key: 'pageNumber', width: 10 },
  { header: 'Line', key: 'lineNumber', width: 10 },
  { header: 'ATC', key: 'atcCode', width: 14 },
  { header: 'Description', key: 'description', width: 38 },
  { header: 'Month 1', key: 'firstMonthAmount', width: 16 },
  { header: 'Month 2', key: 'secondMonthAmount', width: 16 },
  { header: 'Month 3', key: 'thirdMonthAmount', width: 16 },
  { header: 'Tax Base', key: 'taxBase', width: 18 },
  { header: 'Configured Rate', key: 'taxRate', width: 18 },
  { header: 'Tax Withheld', key: 'taxWithheld', width: 18 },
] as const

const addAtcDetailsWorksheet = (
  workbook: ExcelJS.Workbook,
  rows: Array<Bir2307AtcDetailRow>,
) => {
  const worksheet = workbook.addWorksheet('ATC Details', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })
  worksheet.columns = ATC_DETAIL_COLUMNS.map((column) => ({ ...column }))
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ATC_DETAIL_COLUMNS.length },
  }

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: 'middle' }
  headerRow.height = 24
  headerRow.eachCell((cell) => {
    cell.border = THIN_BORDER
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' },
    }
  })

  for (const row of rows) {
    const detailRow = worksheet.addRow(row)
    detailRow.eachCell((cell) => {
      cell.border = THIN_BORDER
      cell.alignment = { vertical: 'top' }
    })
    for (const columnKey of [
      'firstMonthAmount',
      'secondMonthAmount',
      'thirdMonthAmount',
      'taxBase',
      'taxWithheld',
    ]) {
      detailRow.getCell(columnKey).numFmt = '#,##0.00'
    }
    detailRow.getCell('taxRate').numFmt = '0.0000%'
    detailRow.getCell('payeeTin').numFmt = '@'
    detailRow.getCell('payorTin').numFmt = '@'
  }
}

export const buildBir2307ExportWorkbook = async (
  rows: Array<Bir2307ExportRow>,
  atcDetailRows: Array<Bir2307AtcDetailRow> = [],
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook()
  const templateBuffer = Buffer.from(
    BIR_2307_EXPORT_TEMPLATE_BASE64,
    'base64',
  ) as unknown as Buffer
  await workbook.xlsx.load(templateBuffer as never)

  const worksheet = workbook.getWorksheet(SHEET_NAME)
  if (!worksheet) {
    throw new Error('BIR 2307 export template sheet is missing.')
  }

  reflowTemplateHeaders(worksheet)
  clearTemplateSampleRows(worksheet)
  prepareDataRows(worksheet, rows.length)

  rows.forEach((row, index) => {
    writeRow(worksheet, DATA_START_ROW + index, row)
  })
  addAtcDetailsWorksheet(workbook, atcDetailRows)

  return Buffer.from(await workbook.xlsx.writeBuffer()) as unknown as Buffer
}

export const buildBatchBir2307ExportFileName = (uploadBatchId: string) =>
  `BIR-2307-Export-Batch-${uploadBatchId.slice(0, 8)}.xlsx`

export const exportBatchBir2307Report = async (uploadBatchId: string) => {
  const db = getDb()
  const [records, nonCertificateResults, missingResultFiles] =
    await Promise.all([
      db
        .select()
        .from(certificateResults)
        .where(eq(certificateResults.batchId, uploadBatchId))
        .orderBy(asc(certificateResults.createdAt), asc(certificateResults.id)),
      db
        .select({ id: documentResults.id })
        .from(documentResults)
        .where(
          and(
            eq(documentResults.batchId, uploadBatchId),
            eq(documentResults.status, 'error'),
            eq(documentResults.certificateCount, 0),
          ),
        ),
      db
        .select({ id: intakeFiles.id })
        .from(intakeFiles)
        .leftJoin(documentResults, eq(documentResults.uploadId, intakeFiles.id))
        .where(
          and(
            eq(intakeFiles.batchId, uploadBatchId),
            isNull(intakeFiles.removedFromBatchAt),
            isNull(intakeFiles.purgeStatus),
            isNull(documentResults.id),
          ),
        )
        .orderBy(asc(intakeFiles.createdAt), asc(intakeFiles.id)),
    ])

  const taxRows =
    records.length === 0
      ? []
      : await db
          .select()
          .from(certificateTaxRows)
          .where(
            inArray(
              certificateTaxRows.certificateId,
              records.map((record) => record.id),
            ),
          )
          .orderBy(
            asc(certificateTaxRows.certificateId),
            asc(certificateTaxRows.pageNumber),
            asc(certificateTaxRows.lineNumber),
          )
  const rows = buildBir2307ExportRows(
    records,
    missingResultFiles.length + nonCertificateResults.length,
    taxRows,
  )
  const atcDetailRows = buildBir2307AtcDetailRows(records, taxRows)

  if (rows.length === 0) {
    throw new Error('No extracted 2307 rows found for this upload batch.')
  }

  const content = await buildBir2307ExportWorkbook(rows, atcDetailRows)

  return {
    fileName: buildBatchBir2307ExportFileName(uploadBatchId),
    content,
  }
}
