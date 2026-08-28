import { parse } from 'csv-parse/sync'

import { getDb } from '@/lib/db'
import { assertReferenceDataRowLimit } from '@/lib/reference-data'
import { atcCodes } from '@/lib/schema'

const csvHeaderToColumn = {
  'tax type': 'taxType',
  atc: 'code',
  description: 'description',
  'tax rate': 'rate',
} as const

const supportedCsvHeaders = [
  'Tax Type',
  'ATC',
  'Description',
  'Tax Rate',
] as const

type AtcCodeInsert = typeof atcCodes.$inferInsert

const requiredNormalizedHeaders = Object.keys(csvHeaderToColumn) as Array<
  keyof typeof csvHeaderToColumn
>

const normalizeHeader = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, ' ')

const normalizeCell = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const normalizeAtcCode = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, '')

  return normalized.length > 0 ? normalized : null
}

const toInvalidCsvError = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error
  }

  return new Error('Invalid CSV file.')
}

const parseTaxRate = (value: unknown, code: string): number => {
  if (typeof value !== 'string') {
    throw new Error(`Tax rate is required for ATC ${code}.`)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Tax rate is required for ATC ${code}.`)
  }

  const isPercent = trimmed.includes('%')
  const numericText = isPercent ? trimmed.replace(/%/gu, '').trim() : trimmed
  const parsed = Number(numericText)
  const rate = isPercent ? parsed / 100 : parsed

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Tax rate must be positive for ATC ${code}.`)
  }

  return rate
}

export const isCsvFileUpload = (file: Pick<File, 'name'>) =>
  file.name.trim().toLowerCase().endsWith('.csv')

export const parseAtcCodesCsv = (csvText: string): Array<AtcCodeInsert> => {
  if (csvText.replace(/^\uFEFF/, '').trim().length === 0) {
    throw new Error('CSV file is empty.')
  }

  let parsedHeaders: Array<string> = []

  try {
    const records = parse(csvText, {
      bom: true,
      columns: (headers) => {
        parsedHeaders = headers.map((header) => normalizeHeader(String(header)))
        return parsedHeaders
      },
      skip_empty_lines: true,
      trim: false,
    })

    const missingHeaders = requiredNormalizedHeaders.filter(
      (header) => !parsedHeaders.includes(header),
    )

    if (missingHeaders.length > 0) {
      const missingHeaderSet = new Set<string>(missingHeaders)
      const missingLabels = supportedCsvHeaders.filter((header) =>
        missingHeaderSet.has(normalizeHeader(header)),
      )

      throw new Error(
        `CSV is missing required headers: ${missingLabels.join(', ')}.`,
      )
    }

    assertReferenceDataRowLimit(records.length)

    const seenCodes = new Set<string>()

    return records.map((record) => {
      const code = normalizeAtcCode(record.atc)
      if (!code) {
        throw new Error('ATC code is required.')
      }

      if (seenCodes.has(code)) {
        throw new Error(`CSV contains duplicate ATC code: ${code}.`)
      }
      seenCodes.add(code)

      const taxType = normalizeCell(record['tax type'])
      if (!taxType) {
        throw new Error(`Tax type is required for ATC ${code}.`)
      }

      const description = normalizeCell(record.description)
      if (!description) {
        throw new Error(`Description is required for ATC ${code}.`)
      }

      return {
        taxType,
        code,
        description,
        rate: parseTaxRate(record['tax rate'], code),
      }
    })
  } catch (error) {
    throw toInvalidCsvError(error)
  }
}

export const replaceAtcCodeRows = async (rows: Array<AtcCodeInsert>) => {
  const db = getDb()
  const rowsToInsert = rows.map((row) => ({
    ...row,
    code: normalizeAtcCode(row.code) ?? row.code,
  }))

  await db.transaction(async (tx) => {
    await tx.delete(atcCodes)

    if (rowsToInsert.length > 0) {
      await tx.insert(atcCodes).values(rowsToInsert)
    }
  })

  return rows.length
}

export const importAtcCodesCsvFile = async (
  file: Pick<File, 'name' | 'text'>,
) => {
  if (!isCsvFileUpload(file)) {
    throw new Error('Only CSV files are supported.')
  }

  const rows = parseAtcCodesCsv(await file.text())
  const insertedCount = await replaceAtcCodeRows(rows)

  return {
    insertedCount,
    replaced: true as const,
    fileName: file.name,
  }
}
