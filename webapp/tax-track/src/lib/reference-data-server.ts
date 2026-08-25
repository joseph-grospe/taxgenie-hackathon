import { and, asc, desc, eq, ilike, ne, or, sql } from 'drizzle-orm'
import type { SQL, SQLWrapper } from 'drizzle-orm'

import type {
  AtcCodeReferenceRow,
  EntityReferenceRow,
  MasterlistReferenceRow,
  ReferenceDataDataset,
  ReferenceDataFacets,
  ReferenceDataRow,
  ReferenceDataSummary,
} from '@/lib/reference-data'
import type {
  ReferenceDataCompletenessFilter,
  ReferenceDataGovernmentFilter,
  ReferenceDataSortDirection,
  ReferenceDataSortKey,
} from '@/lib/reference-data-search-state'

import { getDb } from '@/lib/db'
import {
  atcCodeRowInputSchema,
  entityRowInputSchema,
  masterlistRowInputSchema,
} from '@/lib/reference-data'
import {
  atcCodes,
  entities,
  intakeBatches,
  masterlist,
  salesReports,
} from '@/lib/schema'

export class ReferenceDataServiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message)
    this.name = 'ReferenceDataServiceError'
  }
}

export type ReferenceDataListOptions = {
  q: string
  region: string
  entity: string
  government: ReferenceDataGovernmentFilter
  tinState: ReferenceDataCompletenessFilter
  emailState: ReferenceDataCompletenessFilter
  taxType: string
  rate: string
  sort: ReferenceDataSortKey
  direction: ReferenceDataSortDirection
  page: number
  pageSize: number
}

export type ReferenceDataListResult = {
  dataset: ReferenceDataDataset
  rows: Array<ReferenceDataRow>
  total: number
  page: number
  pageSize: number
  totalPages: number
  facets: ReferenceDataFacets
}

const emptyFacets = (): ReferenceDataFacets => ({
  regions: [],
  entities: [],
  taxTypes: [],
  rates: [],
  governmentCustomers: 0,
})

const masterlistSelection = {
  id: masterlist.id,
  region: masterlist.region,
  entity: masterlist.entity,
  shortName: masterlist.shortName,
  customerName: masterlist.customerName,
  tin: masterlist.tin,
  address: masterlist.address,
  emailAddress: masterlist.emailAddress,
  isGovernment: masterlist.isGovernment,
}

const entitySelection = {
  id: entities.id,
  shortName: entities.shortName,
  companyName: entities.companyName,
  birRegisteredAddress: entities.birRegisteredAddress,
  zipCode: entities.zipCode,
  tin: entities.tin,
  emailAddress: entities.emailAddress,
  regionEmailAddress: entities.regionEmailAddress,
}

const atcCodeSelection = {
  id: atcCodes.id,
  taxType: atcCodes.taxType,
  code: atcCodes.code,
  description: atcCodes.description,
  rate: atcCodes.rate,
}

const getPagination = (total: number, page: number, pageSize: number) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, totalPages)

  return {
    totalPages,
    currentPage,
    offset: (currentPage - 1) * pageSize,
  }
}

const isBlank = (column: SQLWrapper) =>
  sql<boolean>`nullif(btrim(coalesce(${column}, '')), '') is null`

const isPresent = (column: SQLWrapper) =>
  sql<boolean>`nullif(btrim(coalesce(${column}, '')), '') is not null`

const isCaseInsensitiveExact = (column: SQLWrapper, value: string) =>
  sql<boolean>`lower(btrim(coalesce(${column}, ''))) = lower(${value})`

const sortExpression = (
  column: SQLWrapper,
  direction: ReferenceDataSortDirection,
) => (direction === 'desc' ? desc(column) : asc(column))

const getMasterlistSortColumn = (sort: ReferenceDataSortKey) => {
  switch (sort) {
    case 'tin':
      return masterlist.tin
    case 'shortName':
      return masterlist.shortName
    case 'entity':
      return masterlist.entity
    case 'region':
      return masterlist.region
    case 'emailAddress':
      return masterlist.emailAddress
    case 'isGovernment':
      return masterlist.isGovernment
    default:
      return masterlist.customerName
  }
}

const getEntitySortColumn = (sort: ReferenceDataSortKey) => {
  switch (sort) {
    case 'companyName':
      return entities.companyName
    case 'tin':
      return entities.tin
    case 'zipCode':
      return entities.zipCode
    case 'emailAddress':
      return entities.emailAddress
    case 'regionEmailAddress':
      return entities.regionEmailAddress
    default:
      return entities.shortName
  }
}

const getAtcCodeSortColumn = (sort: ReferenceDataSortKey) => {
  switch (sort) {
    case 'taxType':
      return atcCodes.taxType
    case 'description':
      return atcCodes.description
    case 'rate':
      return atcCodes.rate
    default:
      return atcCodes.code
  }
}

const listMasterlistRows = async (
  options: ReferenceDataListOptions,
): Promise<Omit<ReferenceDataListResult, 'dataset'>> => {
  const db = getDb()
  const pattern = `%${options.q}%`
  const conditions: Array<SQL> = []
  const searchCondition = options.q
    ? or(
        ilike(masterlist.region, pattern),
        ilike(masterlist.entity, pattern),
        ilike(masterlist.shortName, pattern),
        ilike(masterlist.customerName, pattern),
        ilike(masterlist.tin, pattern),
        ilike(masterlist.address, pattern),
        ilike(masterlist.emailAddress, pattern),
      )
    : undefined
  if (searchCondition) conditions.push(searchCondition)
  if (options.region) {
    conditions.push(isCaseInsensitiveExact(masterlist.region, options.region))
  }
  if (options.entity) {
    conditions.push(isCaseInsensitiveExact(masterlist.entity, options.entity))
  }
  if (options.government !== 'all') {
    conditions.push(eq(masterlist.isGovernment, options.government === 'yes'))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [countRows, governmentRows, regionRows, entityRows] = await Promise.all(
    [
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(masterlist)
        .where(where),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(masterlist)
        .where(eq(masterlist.isGovernment, true)),
      db
        .selectDistinct({ value: masterlist.region })
        .from(masterlist)
        .where(isPresent(masterlist.region))
        .orderBy(asc(masterlist.region)),
      db
        .selectDistinct({ value: masterlist.entity })
        .from(masterlist)
        .where(isPresent(masterlist.entity))
        .orderBy(asc(masterlist.entity)),
    ],
  )
  const total = countRows[0]?.value ?? 0
  const pagination = getPagination(total, options.page, options.pageSize)
  const sortColumn = getMasterlistSortColumn(options.sort)
  const rows = await db
    .select(masterlistSelection)
    .from(masterlist)
    .where(where)
    .orderBy(sortExpression(sortColumn, options.direction), asc(masterlist.id))
    .limit(options.pageSize)
    .offset(pagination.offset)

  return {
    rows,
    total,
    page: pagination.currentPage,
    pageSize: options.pageSize,
    totalPages: pagination.totalPages,
    facets: {
      ...emptyFacets(),
      regions: regionRows.flatMap((row) => (row.value ? [row.value] : [])),
      entities: entityRows.flatMap((row) => (row.value ? [row.value] : [])),
      governmentCustomers: governmentRows[0]?.value ?? 0,
    },
  }
}

const listEntityRows = async (
  options: ReferenceDataListOptions,
): Promise<Omit<ReferenceDataListResult, 'dataset'>> => {
  const db = getDb()
  const pattern = `%${options.q}%`
  const conditions: Array<SQL> = []
  const searchCondition = options.q
    ? or(
        ilike(entities.shortName, pattern),
        ilike(entities.companyName, pattern),
        ilike(entities.birRegisteredAddress, pattern),
        ilike(entities.zipCode, pattern),
        ilike(entities.tin, pattern),
        ilike(entities.emailAddress, pattern),
        ilike(entities.regionEmailAddress, pattern),
      )
    : undefined
  if (searchCondition) conditions.push(searchCondition)
  if (options.tinState !== 'all') {
    conditions.push(
      options.tinState === 'present'
        ? isPresent(entities.tin)
        : isBlank(entities.tin),
    )
  }
  if (options.emailState !== 'all') {
    const hasEitherEmail = or(
      isPresent(entities.emailAddress),
      isPresent(entities.regionEmailAddress),
    )
    const hasNoEmail = and(
      isBlank(entities.emailAddress),
      isBlank(entities.regionEmailAddress),
    )
    const condition =
      options.emailState === 'present' ? hasEitherEmail : hasNoEmail
    if (condition) conditions.push(condition)
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined
  const total =
    (
      await db
        .select({ value: sql<number>`count(*)::int` })
        .from(entities)
        .where(where)
    )[0]?.value ?? 0
  const pagination = getPagination(total, options.page, options.pageSize)
  const sortColumn = getEntitySortColumn(options.sort)
  const rows = await db
    .select(entitySelection)
    .from(entities)
    .where(where)
    .orderBy(sortExpression(sortColumn, options.direction), asc(entities.id))
    .limit(options.pageSize)
    .offset(pagination.offset)

  return {
    rows,
    total,
    page: pagination.currentPage,
    pageSize: options.pageSize,
    totalPages: pagination.totalPages,
    facets: emptyFacets(),
  }
}

const listAtcCodeRows = async (
  options: ReferenceDataListOptions,
): Promise<Omit<ReferenceDataListResult, 'dataset'>> => {
  const db = getDb()
  const pattern = `%${options.q}%`
  const conditions: Array<SQL> = []
  const searchCondition = options.q
    ? or(
        ilike(atcCodes.taxType, pattern),
        ilike(atcCodes.code, pattern),
        ilike(atcCodes.description, pattern),
      )
    : undefined
  if (searchCondition) conditions.push(searchCondition)
  if (options.taxType) {
    conditions.push(isCaseInsensitiveExact(atcCodes.taxType, options.taxType))
  }
  if (options.rate) {
    conditions.push(eq(atcCodes.rate, Number(options.rate)))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [countRows, taxTypeRows, rateRows] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(atcCodes)
      .where(where),
    db
      .selectDistinct({ value: atcCodes.taxType })
      .from(atcCodes)
      .orderBy(asc(atcCodes.taxType)),
    db
      .selectDistinct({ value: atcCodes.rate })
      .from(atcCodes)
      .orderBy(asc(atcCodes.rate)),
  ])
  const total = countRows[0]?.value ?? 0
  const pagination = getPagination(total, options.page, options.pageSize)
  const sortColumn = getAtcCodeSortColumn(options.sort)
  const rows = await db
    .select(atcCodeSelection)
    .from(atcCodes)
    .where(where)
    .orderBy(sortExpression(sortColumn, options.direction), asc(atcCodes.id))
    .limit(options.pageSize)
    .offset(pagination.offset)

  return {
    rows,
    total,
    page: pagination.currentPage,
    pageSize: options.pageSize,
    totalPages: pagination.totalPages,
    facets: {
      ...emptyFacets(),
      taxTypes: taxTypeRows.map((row) => row.value),
      rates: rateRows.map((row) => row.value),
    },
  }
}

export const listReferenceDataRows = async (
  dataset: ReferenceDataDataset,
  options: ReferenceDataListOptions,
): Promise<ReferenceDataListResult> => {
  switch (dataset) {
    case 'masterlist':
      return { dataset, ...(await listMasterlistRows(options)) }
    case 'entities':
      return { dataset, ...(await listEntityRows(options)) }
    case 'atc-codes':
      return { dataset, ...(await listAtcCodeRows(options)) }
  }
}

export const getReferenceDataSummary =
  async (): Promise<ReferenceDataSummary> => {
    const db = getDb()
    const [masterlistRows, entityRows, atcCodeRows] = await Promise.all([
      db.select({ value: sql<number>`count(*)::int` }).from(masterlist),
      db.select({ value: sql<number>`count(*)::int` }).from(entities),
      db.select({ value: sql<number>`count(*)::int` }).from(atcCodes),
    ])

    return {
      masterlist: masterlistRows[0]?.value ?? 0,
      entities: entityRows[0]?.value ?? 0,
      'atc-codes': atcCodeRows[0]?.value ?? 0,
    }
  }

const requireParsedRow = <T>(
  parsed:
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ message: string }> } },
): T => {
  if (!parsed.success) {
    throw new ReferenceDataServiceError(
      parsed.error.issues[0]?.message ?? 'Invalid reference data row.',
    )
  }

  return parsed.data
}

const ensureUniqueEntityTin = async (tin: string | null, exceptId?: number) => {
  if (!tin) {
    return
  }

  const db = getDb()
  const normalizedTinMatches = sql`regexp_replace(coalesce(${entities.tin}, ''), '[^0-9]', '', 'g') = ${tin}`
  const where = exceptId
    ? and(normalizedTinMatches, ne(entities.id, exceptId))
    : normalizedTinMatches
  const duplicate = await db
    .select({ id: entities.id })
    .from(entities)
    .where(where)
    .limit(1)

  if (duplicate.length > 0) {
    throw new ReferenceDataServiceError(
      'An entity with this normalized TIN already exists.',
      409,
    )
  }
}

const ensureUniqueAtcCode = async (code: string, exceptId?: number) => {
  const db = getDb()
  const where = exceptId
    ? and(eq(atcCodes.code, code), ne(atcCodes.id, exceptId))
    : eq(atcCodes.code, code)
  const duplicate = await db
    .select({ id: atcCodes.id })
    .from(atcCodes)
    .where(where)
    .limit(1)

  if (duplicate.length > 0) {
    throw new ReferenceDataServiceError(`ATC code ${code} already exists.`, 409)
  }
}

export const createReferenceDataRow = async (
  dataset: ReferenceDataDataset,
  input: unknown,
): Promise<ReferenceDataRow> => {
  const db = getDb()

  switch (dataset) {
    case 'masterlist': {
      const data = requireParsedRow(masterlistRowInputSchema.safeParse(input))
      const row = (
        await db.insert(masterlist).values(data).returning(masterlistSelection)
      )[0]
      return row as MasterlistReferenceRow
    }
    case 'entities': {
      const data = requireParsedRow(entityRowInputSchema.safeParse(input))
      await ensureUniqueEntityTin(data.tin)
      const row = (
        await db.insert(entities).values(data).returning(entitySelection)
      )[0]
      return row as EntityReferenceRow
    }
    case 'atc-codes': {
      const data = requireParsedRow(atcCodeRowInputSchema.safeParse(input))
      await ensureUniqueAtcCode(data.code)
      const row = (
        await db.insert(atcCodes).values(data).returning(atcCodeSelection)
      )[0]
      return row as AtcCodeReferenceRow
    }
  }
}

export const updateReferenceDataRow = async (
  dataset: ReferenceDataDataset,
  rowId: number,
  input: unknown,
): Promise<ReferenceDataRow> => {
  const db = getDb()

  switch (dataset) {
    case 'masterlist': {
      const data = requireParsedRow(masterlistRowInputSchema.safeParse(input))
      const rows = await db
        .update(masterlist)
        .set(data)
        .where(eq(masterlist.id, rowId))
        .returning(masterlistSelection)
      if (rows.length === 0) {
        throw new ReferenceDataServiceError(
          'Masterlist row was not found.',
          404,
        )
      }
      return rows[0] as MasterlistReferenceRow
    }
    case 'entities': {
      const data = requireParsedRow(entityRowInputSchema.safeParse(input))
      await ensureUniqueEntityTin(data.tin, rowId)
      const rows = await db
        .update(entities)
        .set(data)
        .where(eq(entities.id, rowId))
        .returning(entitySelection)
      if (rows.length === 0) {
        throw new ReferenceDataServiceError('Entity was not found.', 404)
      }
      return rows[0] as EntityReferenceRow
    }
    case 'atc-codes': {
      const data = requireParsedRow(atcCodeRowInputSchema.safeParse(input))
      await ensureUniqueAtcCode(data.code, rowId)
      const rows = await db
        .update(atcCodes)
        .set(data)
        .where(eq(atcCodes.id, rowId))
        .returning(atcCodeSelection)
      if (rows.length === 0) {
        throw new ReferenceDataServiceError('ATC code was not found.', 404)
      }
      return rows[0] as AtcCodeReferenceRow
    }
  }
}

const deleteEntityRow = async (rowId: number) => {
  const db = getDb()
  const [batchReference, reportReference] = await Promise.all([
    db
      .select({ id: intakeBatches.id })
      .from(intakeBatches)
      .where(eq(intakeBatches.entityId, rowId))
      .limit(1),
    db
      .select({ id: salesReports.id })
      .from(salesReports)
      .where(eq(salesReports.entityId, rowId))
      .limit(1),
  ])

  if (batchReference.length > 0 || reportReference.length > 0) {
    throw new ReferenceDataServiceError(
      'This entity is used by an upload batch or sales report and cannot be deleted.',
      409,
    )
  }

  const deleted = await db
    .delete(entities)
    .where(eq(entities.id, rowId))
    .returning({ id: entities.id })

  if (deleted.length === 0) {
    throw new ReferenceDataServiceError('Entity was not found.', 404)
  }
}

export const deleteReferenceDataRow = async (
  dataset: ReferenceDataDataset,
  rowId: number,
) => {
  const db = getDb()

  switch (dataset) {
    case 'masterlist': {
      const deleted = await db
        .delete(masterlist)
        .where(eq(masterlist.id, rowId))
        .returning({ id: masterlist.id })
      if (deleted.length === 0) {
        throw new ReferenceDataServiceError(
          'Masterlist row was not found.',
          404,
        )
      }
      return
    }
    case 'entities':
      return deleteEntityRow(rowId)
    case 'atc-codes': {
      const deleted = await db
        .delete(atcCodes)
        .where(eq(atcCodes.id, rowId))
        .returning({ id: atcCodes.id })
      if (deleted.length === 0) {
        throw new ReferenceDataServiceError('ATC code was not found.', 404)
      }
    }
  }
}

export const getReferenceDataErrorStatus = (error: unknown) => {
  if (error instanceof ReferenceDataServiceError) {
    return error.status
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  ) {
    return 409
  }

  return 400
}
