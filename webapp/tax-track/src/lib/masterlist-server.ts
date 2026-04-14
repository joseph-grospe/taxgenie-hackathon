import { parse } from 'csv-parse/sync'

import { getDb } from '@/lib/db'
import { masterlist } from '@/lib/schema'

const csvHeaderToColumn = {
  region: 'region',
  entity: 'entity',
  'short name': 'shortName',
  'customer name': 'customerName',
  tin: 'tin',
  address: 'address',
  'email address': 'emailAddress',
} as const

const supportedCsvHeaders = [
  'REGION',
  'ENTITY',
  'Short Name',
  'CUSTOMER NAME',
  'TIN',
  'Address',
  'Email Address',
] as const

type MasterlistInsert = typeof masterlist.$inferInsert

const requiredNormalizedHeaders = Object.keys(csvHeaderToColumn) as Array<
  keyof typeof csvHeaderToColumn
>

const normalizeHeader = (value: string) => value.trim().toLowerCase()

const normalizeCell = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const toInvalidCsvError = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error
  }

  return new Error('Invalid CSV file.')
}

export const isCsvFileUpload = (file: Pick<File, 'name'>) =>
  file.name.trim().toLowerCase().endsWith('.csv')

export const parseMasterlistCsv = (csvText: string): MasterlistInsert[] => {
  if (csvText.replace(/^\uFEFF/, '').trim().length === 0) {
    throw new Error('CSV file is empty.')
  }

  let parsedHeaders: string[] = []

  try {
    const records = parse(csvText, {
      bom: true,
      columns: (headers) => {
        parsedHeaders = headers.map((header) => normalizeHeader(String(header)))
        return parsedHeaders
      },
      skip_empty_lines: true,
      trim: false,
    }) as Array<Record<string, string>>

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

    return records.map((record) => ({
      region: normalizeCell(record.region),
      entity: normalizeCell(record.entity),
      shortName: normalizeCell(record['short name']),
      customerName: normalizeCell(record['customer name']),
      tin: normalizeCell(record.tin),
      address: normalizeCell(record.address),
      emailAddress: normalizeCell(record['email address']),
    }))
  } catch (error) {
    throw toInvalidCsvError(error)
  }
}

export const replaceMasterlistRows = async (rows: MasterlistInsert[]) => {
  const db = getDb()

  await db.transaction(async (tx) => {
    await tx.delete(masterlist)

    if (rows.length > 0) {
      await tx.insert(masterlist).values(rows)
    }
  })

  return rows.length
}

export const importMasterlistCsvFile = async (
  file: Pick<File, 'name' | 'text'>,
) => {
  if (!isCsvFileUpload(file)) {
    throw new Error('Only CSV files are supported.')
  }

  const rows = parseMasterlistCsv(await file.text())
  const insertedCount = await replaceMasterlistRows(rows)

  return {
    insertedCount,
    replaced: true as const,
    fileName: file.name,
  }
}
