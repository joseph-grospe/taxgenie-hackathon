import { parse } from 'csv-parse/sync'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import { normalizeTinDigits } from '@taxgenie/shared/utils/tin'

import type { EntityScopeFilter, EntityScopeOption } from '@/lib/entity-scope'
import type { UploadEntityOption } from '@/lib/upload-intake-types'

import { getDb } from '@/lib/db'
import {
  assertReferenceDataRowLimit,
  entityRowInputSchema,
} from '@/lib/reference-data'
import { entities, intakeBatches, salesReports } from '@/lib/schema'
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

const entityFieldLabels: Record<string, string> = {
  shortName: 'Short Name',
  companyName: 'Company Name',
  birRegisteredAddress: 'BIR Registered Address',
  zipCode: 'ZIP Code',
  tin: 'TIN',
  emailAddress: 'EMAIL ADDRESS',
  regionEmailAddress: 'REGION',
}

const validateEntityRow = (
  row: EntityInsert,
  rowNumber: number,
): EntityInsert => {
  const parsed = entityRowInputSchema.safeParse(row)
  if (parsed.success) return parsed.data

  const issue = parsed.error.issues[0]
  const field = String(issue.path[0] ?? 'row')
  const label = entityFieldLabels[field] ?? 'Row'
  throw new Error(`CSV row ${rowNumber}, ${label}: ${issue.message}`)
}

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

export const parseEntitiesCsv = (csvText: string): Array<EntityInsert> => {
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
      validateEntityRow(
        {
          shortName: normalizeCell(record['short name']),
          companyName: normalizeCell(record['company name']),
          birRegisteredAddress: normalizeCell(record['bir registered address']),
          zipCode: normalizeCell(record['zip code']),
          tin: normalizeCell(record.tin),
          emailAddress: normalizeCell(record['email address']),
          regionEmailAddress: normalizeCell(record.region),
        },
        index + 2,
      ),
    )
  } catch (error) {
    throw toInvalidCsvError(error)
  }
}

export const replaceEntityRows = async (rows: Array<EntityInsert>) => {
  const db = getDb()
  const rowsToInsert = rows.map((row) => ({
    ...row,
    tin: normalizeTinDigits(row.tin),
  }))

  const incomingTinSet = new Set<string>()
  for (const row of rowsToInsert) {
    if (!row.tin) {
      continue
    }

    if (incomingTinSet.has(row.tin)) {
      throw new Error(`CSV contains duplicate entity TIN: ${row.tin}.`)
    }
    incomingTinSet.add(row.tin)
  }

  await db.transaction(async (tx) => {
    const existingRows = await tx
      .select({ id: entities.id, tin: entities.tin })
      .from(entities)
      .orderBy(asc(entities.id))

    const existingByTin = new Map<string, number>()
    for (const row of existingRows) {
      const normalizedTin = normalizeTinDigits(row.tin)
      if (!normalizedTin) {
        continue
      }

      if (existingByTin.has(normalizedTin)) {
        throw new Error(
          `Existing entity data contains duplicate TIN ${normalizedTin}. Resolve the duplicate rows before importing.`,
        )
      }
      existingByTin.set(normalizedTin, row.id)
    }

    const matchedIds = new Set<number>()
    const newRows: Array<EntityInsert> = []
    const matchedRows: Array<{ id: number; data: EntityInsert }> = []

    for (const row of rowsToInsert) {
      const existingId = row.tin ? existingByTin.get(row.tin) : undefined
      if (existingId) {
        matchedIds.add(existingId)
        matchedRows.push({ id: existingId, data: row })
      } else {
        newRows.push(row)
      }
    }

    const omittedIds = existingRows
      .filter((row) => !matchedIds.has(row.id))
      .map((row) => row.id)

    if (omittedIds.length > 0) {
      const [batchReferences, reportReferences] = await Promise.all([
        tx
          .select({ entityId: intakeBatches.entityId })
          .from(intakeBatches)
          .where(inArray(intakeBatches.entityId, omittedIds))
          .limit(1),
        tx
          .select({ entityId: salesReports.entityId })
          .from(salesReports)
          .where(inArray(salesReports.entityId, omittedIds))
          .limit(1),
      ])

      if (batchReferences.length > 0 || reportReferences.length > 0) {
        throw new Error(
          'The entity CSV omits an entity used by an upload batch or sales report. Include every referenced entity and try again.',
        )
      }
    }

    for (const matched of matchedRows) {
      await tx
        .update(entities)
        .set(matched.data)
        .where(eq(entities.id, matched.id))
    }

    if (omittedIds.length > 0) {
      await tx.delete(entities).where(inArray(entities.id, omittedIds))
    }

    if (newRows.length > 0) {
      await tx.insert(entities).values(newRows)
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
