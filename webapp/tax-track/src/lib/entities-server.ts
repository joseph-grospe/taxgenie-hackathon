import { parse } from 'csv-parse/sync'
import { asc, eq, sql } from 'drizzle-orm'
import { normalizeTinDigits } from '@taxtrack/shared/utils/tin'

import { getDb } from '@/lib/db'
import { entities } from '@/lib/schema'
import type { EntityScopeFilter, EntityScopeOption } from '@/lib/entity-scope'
import type { UploadEntityOption } from '@/lib/upload-intake-types'
import { buildEntityScopeLabel, parseEntityScopeId } from '@/lib/entity-scope'

const csvHeaderToColumn = {
  'short name': 'shortName',
  'company name': 'companyName',
  'bir registered address': 'birRegisteredAddress',
  'zip code': 'zipCode',
  tin: 'tin',
  'email address': 'emailAddress',
  region: 'regionEmailAddress',
} as const

const supportedCsvHeaders = [
  'Short Name',
  'Company Name',
  'BIR Registered Address',
  'ZIP Code',
  'TIN',
  'EMAIL ADDRESS',
  'REGION',
] as const

type EntityInsert = typeof entities.$inferInsert

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

export const toTinPrefix9 = (value: string | null | undefined) => {
  const normalized = normalizeTinDigits(value)
  return normalized && normalized.length >= 9 ? normalized.slice(0, 9) : null
}

const toEntityScopeOption = (
  row: Pick<EntityScopeOption, 'id' | 'shortName' | 'companyName' | 'tin'>,
): EntityScopeOption => ({
  ...row,
  label: buildEntityScopeLabel(row),
})

export const parseEntityFilterIdInput = (
  value: unknown,
  message = 'Invalid entity filter.',
) => {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value > 0) {
      return value
    }

    throw new Error(message)
  }

  if (typeof value !== 'string') {
    throw new Error(message)
  }

  const entityId = parseEntityScopeId(value)
  if (!entityId && value.trim().length > 0) {
    throw new Error(message)
  }

  return entityId ? Number.parseInt(entityId, 10) : null
}

const toInvalidCsvError = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error
  }

  return new Error('Invalid CSV file.')
}

export const isCsvFileUpload = (file: Pick<File, 'name'>) =>
  file.name.trim().toLowerCase().endsWith('.csv')

export const parseEntitiesCsv = (csvText: string): EntityInsert[] => {
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
      shortName: normalizeCell(record['short name']),
      companyName: normalizeCell(record['company name']),
      birRegisteredAddress: normalizeCell(record['bir registered address']),
      zipCode: normalizeCell(record['zip code']),
      tin: normalizeTinDigits(record.tin),
      emailAddress: normalizeCell(record['email address']),
      regionEmailAddress: normalizeCell(record.region),
    }))
  } catch (error) {
    throw toInvalidCsvError(error)
  }
}

export const replaceEntityRows = async (rows: EntityInsert[]) => {
  const db = getDb()
  const rowsToInsert = rows.map((row) => ({
    ...row,
    tin: normalizeTinDigits(row.tin),
  }))

  await db.transaction(async (tx) => {
    await tx.delete(entities)

    if (rowsToInsert.length > 0) {
      await tx.insert(entities).values(rowsToInsert)
    }
  })

  return rows.length
}

export const importEntitiesCsvFile = async (
  file: Pick<File, 'name' | 'text'>,
) => {
  if (!isCsvFileUpload(file)) {
    throw new Error('Only CSV files are supported.')
  }

  const rows = parseEntitiesCsv(await file.text())
  const insertedCount = await replaceEntityRows(rows)

  return {
    insertedCount,
    replaced: true as const,
    fileName: file.name,
  }
}

export const listEntityScopeOptions = async (): Promise<
  Array<EntityScopeOption>
> => {
  const db = getDb()
  const rows = await db
    .select({
      id: entities.id,
      shortName: entities.shortName,
      companyName: entities.companyName,
      tin: entities.tin,
    })
    .from(entities)
    .orderBy(
      asc(entities.shortName),
      asc(entities.companyName),
      asc(entities.id),
    )

  return rows.map(toEntityScopeOption)
}

export const resolveEntityScopeFilterById = async (
  input: unknown,
  options: { message?: string; notFoundMessage?: string } = {},
): Promise<EntityScopeFilter | null> => {
  const entityId = parseEntityFilterIdInput(input, options.message)
  if (entityId === null) {
    return null
  }

  const db = getDb()
  const row = (
    await db
      .select({
        id: entities.id,
        shortName: entities.shortName,
        companyName: entities.companyName,
        tin: entities.tin,
      })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1)
  ).at(0)

  if (!row) {
    throw new Error(options.notFoundMessage ?? 'Selected entity was not found.')
  }

  return row
}

export const listUploadEntities = async (): Promise<
  Array<UploadEntityOption>
> => {
  const db = getDb()
  const rows = await db
    .select({
      id: entities.id,
      shortName: entities.shortName,
      companyName: entities.companyName,
      tin: entities.tin,
    })
    .from(entities)
    .where(
      sql`length(regexp_replace(coalesce(${entities.tin}, ''), '[^0-9]', '', 'g')) >= 9`,
    )
    .orderBy(
      asc(entities.shortName),
      asc(entities.companyName),
      asc(entities.id),
    )

  return rows.flatMap((row) => {
    const tin = normalizeTinDigits(row.tin)
    const tinPrefix = toTinPrefix9(tin)
    if (!tin || !tinPrefix) {
      return []
    }

    return [
      {
        id: row.id,
        shortName: row.shortName,
        companyName: row.companyName,
        tin,
        tinPrefix,
      },
    ]
  })
}
