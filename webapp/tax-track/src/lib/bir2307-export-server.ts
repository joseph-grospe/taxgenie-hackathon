import { asc, eq } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'

import { BIR_2307_EXPORT_TEMPLATE_BASE64 } from '@/lib/bir2307-export-template'
import { getDb } from '@/lib/db'
import { documentResults } from '@/lib/schema'

const SHEET_NAME = 'Sheet1'
const DATA_START_ROW = 4
const FIRST_COLUMN = 1
const LAST_COLUMN = 17
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
  'A1:Q1',
  'B2:F2',
  'G2:O2',
  'P2:P3',
  'Q2:Q3',
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
  'ATC',
  'Tax Withheld',
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
const TAX_WITHHELD_COLUMN_INDEX = 14
const CONDITION_COLUMN_INDEX = 16

export type Bir2307ExportRow = {
  period: Date | null
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
  taxWithheld: number | null
  duplicateStatus: 'DUPLICATE' | 'UNIQUE'
  condition: 'GOOD' | 'ERROR'
}

type DocumentResultRecord = typeof documentResults.$inferSelect

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {}

const hasOwn = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key)

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

const toBooleanish = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value > 0
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (
      ['true', '1', 'yes', 'y', 'present', 'exists', 'signed'].includes(
        normalized,
      )
    ) {
      return true
    }

    if (
      ['false', '0', 'no', 'n', 'absent', 'missing', 'unsigned'].includes(
        normalized,
      )
    ) {
      return false
    }
  }

  return null
}

const yesNoFromKnownText = (
  record: Record<string, unknown>,
  key: string,
): 'Yes' | 'No' | null => {
  if (!hasOwn(record, key)) {
    return null
  }

  return toText(record[key]) ? 'Yes' : 'No'
}

const yesNoFromText = (
  record: Record<string, unknown>,
  key: string,
): 'Yes' | 'No' => (toText(record[key]) ? 'Yes' : 'No')

const yesNoFromKnownPresence = (
  record: Record<string, unknown>,
  keys: Array<string>,
): 'Yes' | 'No' | null => {
  for (const key of keys) {
    if (!hasOwn(record, key)) {
      continue
    }

    const parsed = toBooleanish(record[key])
    if (parsed !== null) {
      return parsed ? 'Yes' : 'No'
    }

    return toText(record[key]) ? 'Yes' : 'No'
  }

  return null
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

const isDuplicateRecord = (record: {
  outcome: string
  status: string
  reasonCodes: unknown
}) => {
  const reasonCodes = Array.isArray(record.reasonCodes)
    ? record.reasonCodes
    : []

  return (
    record.outcome === 'Duplicate' ||
    record.status === 'duplicate' ||
    reasonCodes.some(
      (reason) =>
        typeof reason === 'string' &&
        reason.toLowerCase().startsWith('duplicate_'),
    )
  )
}

const hasNormalizedData = (normalized: Record<string, unknown>) =>
  [
    'periodEnd',
    'periodCovered',
    'payeeName',
    'payeeTin',
    'payorName',
    'payorTin',
    'atcCode',
    'taxWithheld',
  ].some((key) => hasOwn(normalized, key))

const mapNormalizedToExportRow = (
  normalized: Record<string, unknown>,
  record: Pick<DocumentResultRecord, 'outcome' | 'status' | 'reasonCodes'>,
): Bir2307ExportRow => {
  const duplicate = isDuplicateRecord(record)
  const period =
    parseBir2307Period(normalized.periodEnd) ??
    parseBir2307Period(normalized.periodCovered)

  return {
    period,
    payeeName: toText(normalized.payeeName),
    payeeTin: toTinText(normalized.payeeTin),
    payeeAddress: toText(normalized.payeeAddress),
    payeeHasAddress: yesNoFromKnownText(normalized, 'payeeAddress'),
    payeeHasZip: yesNoFromText(normalized, 'payeeZip'),
    payorName: toText(normalized.payorName),
    payorTin: toTinText(normalized.payorTin),
    payorAddress: toText(normalized.payorAddress),
    payorHasAddress: yesNoFromKnownText(normalized, 'payorAddress'),
    payorHasZip: yesNoFromText(normalized, 'payorZip'),
    hasPrintedName: yesNoFromKnownText(normalized, 'printedName'),
    hasSignature: yesNoFromKnownPresence(normalized, [
      'signaturePresent',
      'signature',
    ]),
    atcCode: toText(normalized.atcCode),
    taxWithheld: toNumber(normalized.taxWithheld),
    duplicateStatus: duplicate ? 'DUPLICATE' : 'UNIQUE',
    condition: !duplicate && record.status === 'error' ? 'ERROR' : 'GOOD',
  }
}

export const mapDocumentResultToBir2307Rows = (
  record: DocumentResultRecord,
): Array<Bir2307ExportRow> => {
  const payload = toRecord(record.payload)
  const pages = Array.isArray(payload.pages) ? payload.pages : []
  const pageRows = pages.flatMap((page) => {
    const pageRecord = toRecord(page)
    if (pageRecord.classification !== 'certificate') {
      return []
    }

    const normalized = toRecord(pageRecord.normalized)
    return hasNormalizedData(normalized)
      ? [mapNormalizedToExportRow(normalized, record)]
      : []
  })

  if (pageRows.length > 0) {
    return pageRows
  }

  const normalized = toRecord(payload.normalized)
  return hasNormalizedData(normalized)
    ? [mapNormalizedToExportRow(normalized, record)]
    : []
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
  worksheet.getCell('P2').value = 'Duplicate or Unique?'
  worksheet.getCell('Q2').value = 'Condition'

  EXPORT_COLUMN_HEADERS.forEach((header, index) => {
    worksheet.getCell(3, FIRST_COLUMN + index).value = header
  })

  applyStyleToCells(worksheet, 1, FIRST_COLUMN, LAST_COLUMN, titleStyle)
  applyStyleToCells(worksheet, 2, 2, 6, payeeGroupStyle)
  applyStyleToCells(worksheet, 2, 7, 15, payorGroupStyle)
  worksheet.getCell('P2').style = cloneStylePart(duplicateStyle)
  worksheet.getCell('P3').style = cloneStylePart(duplicateStyle)
  worksheet.getCell('Q2').style = cloneStylePart(conditionStyle)
  worksheet.getCell('Q3').style = cloneStylePart(conditionStyle)
  applyStyleToCells(worksheet, 3, FIRST_COLUMN, LAST_COLUMN, headerStyle)
  worksheet.getCell('P3').style = cloneStylePart(duplicateStyle)
  worksheet.getCell('Q3').style = cloneStylePart(conditionStyle)

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
    row.payeeHasAddress,
    row.payeeHasZip ?? 'No',
    row.payorName,
    row.payorTin,
    row.payorAddress,
    row.payorHasAddress,
    row.payorHasZip ?? 'No',
    row.hasPrintedName,
    row.hasSignature,
    row.atcCode,
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
      cell.numFmt = 'mm-dd-yy'
    }

    if (index === TAX_WITHHELD_COLUMN_INDEX) {
      cell.numFmt = '#,##0.00'
    }

    if (index === CONDITION_COLUMN_INDEX && hasCellData(cellValue)) {
      cell.fill = cellValue === 'GOOD' ? GOOD_FILL : ERROR_FILL
    }
  })
}

export const buildBir2307ExportWorkbook = async (
  rows: Array<Bir2307ExportRow>,
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

  return Buffer.from(await workbook.xlsx.writeBuffer()) as unknown as Buffer
}

export const buildBatchBir2307ExportFileName = (uploadBatchId: string) =>
  `BIR-2307-Export-Batch-${uploadBatchId.slice(0, 8)}.xlsx`

export const exportBatchBir2307Report = async (uploadBatchId: string) => {
  const db = getDb()
  const records = await db
    .select()
    .from(documentResults)
    .where(eq(documentResults.batchId, uploadBatchId))
    .orderBy(asc(documentResults.createdAt), asc(documentResults.id))

  const rows = records.flatMap(mapDocumentResultToBir2307Rows)

  if (rows.length === 0) {
    throw new Error('No extracted 2307 rows found for this upload batch.')
  }

  const content = await buildBir2307ExportWorkbook(rows)

  return {
    fileName: buildBatchBir2307ExportFileName(uploadBatchId),
    content,
  }
}
