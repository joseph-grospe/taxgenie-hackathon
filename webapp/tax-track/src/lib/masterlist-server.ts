import { parse } from 'csv-parse/sync'
import { normalizeTinDigits } from '@taxtrack/shared/utils/tin'

import { getDb } from '@/lib/db'
import {
  assertReferenceDataRowLimit,
  masterlistRowInputSchema,
} from '@/lib/reference-data'
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

const masterlistFieldLabels: Record<string, string> = {
  region: 'REGION',
  entity: 'ENTITY',
  shortName: 'Short Name',
  customerName: 'CUSTOMER NAME',
  tin: 'TIN',
  address: 'Address',
  emailAddress: 'Email Address',
  isGovernment: 'Government',
}

const validateMasterlistRow = (
  row: MasterlistInsert,
  rowNumber: number,
): MasterlistInsert => {
  const parsed = masterlistRowInputSchema.safeParse(row)
  if (parsed.success) return parsed.data

  const issue = parsed.error.issues[0]
  const field = String(issue.path[0] ?? 'row')
  const label = masterlistFieldLabels[field] ?? 'Row'
  throw new Error(`CSV row ${rowNumber}, ${label}: ${issue.message}`)
}

const optionalCsvHeaders = {
  government: 'Government',
} as const

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

const normalizeGovernmentCell = (value: unknown, rowNumber: number) => {
  const normalized = normalizeCell(value)
  if (!normalized) {
    return false
  }

  const lowerValue = normalized.toLowerCase()
  if (lowerValue === 'y') {
    return true
  }

  if (lowerValue === 'n') {
    return false
  }

  throw new Error(
    `CSV contains invalid ${optionalCsvHeaders.government} value on row ${rowNumber}. Use Y or N.`,
  )
}

const toInvalidCsvError = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error
  }

  return new Error('Invalid CSV file.')
}

export const isCsvFileUpload = (file: Pick<File, 'name'>) =>
  file.name.trim().toLowerCase().endsWith('.csv')

export const parseMasterlistCsv = (
  csvText: string,
): Array<MasterlistInsert> => {
  if (csvText.replace(/^\uFEFF/, '').trim().length === 0) {
    throw new Error('CSV file is empty.')
  }

  let parsedHeaders: Array<string> = []

  try {
    const records = parse<Record<string, string>>(csvText, {
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

    return records.map((record, index) =>
      validateMasterlistRow(
        {
          region: normalizeCell(record.region),
          entity: normalizeCell(record.entity),
          shortName: normalizeCell(record['short name']),
          customerName: normalizeCell(record['customer name']),
          tin: normalizeCell(record.tin),
          address: normalizeCell(record.address),
          emailAddress: normalizeCell(record['email address']),
          isGovernment: normalizeGovernmentCell(record.government, index + 2),
        },
        index + 2,
      ),
    )
  } catch (error) {
    throw toInvalidCsvError(error)
  }
}

export const replaceMasterlistRows = async (rows: Array<MasterlistInsert>) => {
  const db = getDb()
  const rowsToInsert = rows.map((row) => ({
    ...row,
    tin: normalizeTinDigits(row.tin),
    isGovernment: row.isGovernment ?? false,
  }))

  await db.transaction(async (tx) => {
    await tx.delete(masterlist)

    if (rowsToInsert.length > 0) {
      await tx.insert(masterlist).values(rowsToInsert)
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
