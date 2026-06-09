import { randomUUID } from 'node:crypto'

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  buildEntityStorageKey,
  buildStorageKey,
  normalizeIssuerShortname,
} from '@taxtrack/shared'
import { normalizeTinDigits } from '@taxtrack/shared/utils/tin'
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { SQL } from 'drizzle-orm'

import type {
  SalesReportDetailView,
  SalesReportEntitySnapshot,
  SalesReportListItem,
  SalesReportListResponse,
  SalesReportPresignResponse,
  SalesReportRowView,
  SalesReportRunBatchView,
  SalesReportRunView,
  SalesReportVersionStatus,
  SalesReportVersionView,
} from '@/lib/sales-report-types'
import type { SalesReportSearch } from '@/lib/sales-report-search-state'
import type { ReconciliationTableFilterValue } from '@/lib/reconciliation-table-state'
import type { BatchListPagination } from '@/lib/upload-intake-types'
import {
  createS3ServerClient,
  getStorageBucketName,
  getStoragePrefix,
  sanitizeUploadFileName,
} from '@/lib/aws-server'
import { getDb } from '@/lib/db'
import { resolveEntityScopeFilterById } from '@/lib/entities-server'
import {
  buildDifferenceValues,
  chunkItems,
  fetchMasterlistShortNameLookupForTins,
  fetchTaxRecordCandidates,
  listReconciliationResults,
  parseReconciliationWorkbook,
  pickBestTaxRecordMatch,
  resolveMasterlistIssuerShortnameByTin,
} from '@/lib/reconciliation-server'
import {
  documentResults,
  entities,
  intakeBatches,
  reconciliationResults,
  salesReportRows,
  salesReportRunBatches,
  salesReportRuns,
  salesReportVersions,
  salesReports,
} from '@/lib/schema'

const PRESIGN_EXPIRY_SECONDS = 60 * 15
const MAX_SALES_REPORT_FILE_SIZE_BYTES = 10 * 1024 * 1024
const MAX_SALES_REPORT_ROWS = 5_000
const BULK_INSERT_CHUNK_SIZE = 500
const MAX_SELECTED_BATCHES = 100
const SALES_REPORT_DETAIL_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
const DEFAULT_SALES_REPORT_DETAIL_PAGE_SIZE = 25

const EXCEL_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
])

export const salesReportPresignSchema = z.object({
  reportId: z.string().uuid().optional(),
  entityId: z.number().int().positive(),
  name: z.string().trim().max(120).optional(),
  file: z.object({
    name: z.string().min(1),
    type: z.string().min(1),
    size: z
      .number()
      .int()
      .min(1, 'Sales report file must not be empty.')
      .max(
        MAX_SALES_REPORT_FILE_SIZE_BYTES,
        'Sales report must be 10 MiB or smaller.',
      ),
  }),
})

export const salesReportCompleteSchema = z.object({
  reportId: z.string().uuid(),
  versionId: z.string().uuid(),
})

export const salesReportUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Report name is required.')
    .max(120, 'Report name must be 120 characters or fewer.'),
})

export const salesReportReconcileSchema = z.object({
  batchIds: z
    .array(z.string().uuid())
    .min(1, 'Select at least one closed upload batch.')
    .max(
      MAX_SELECTED_BATCHES,
      `Select ${MAX_SELECTED_BATCHES} batches or fewer.`,
    ),
})

type SalesReportRecord = typeof salesReports.$inferSelect
type SalesReportVersionRecord = typeof salesReportVersions.$inferSelect
type SalesReportRunRecord = typeof salesReportRuns.$inferSelect
type SalesReportRunBatchRecord = typeof salesReportRunBatches.$inferSelect
type SalesReportRowRecord = typeof salesReportRows.$inferSelect
type ReconciliationInsert = typeof reconciliationResults.$inferInsert

type SalesReportListInput = SalesReportSearch
type SalesReportDetailPaginationInput = {
  rowsQ?: string | null
  rowsPage?: number | null
  rowsPageSize?: number | null
  q?: string | null
  filter?: ReconciliationTableFilterValue | null
  resultsPage?: number | null
  resultsPageSize?: number | null
}

type ActiveSalesReportBatchLink = {
  batchId: string
  salesReportId: string
}

const roundMoney = (value: number) => Number(value.toFixed(2))

const uniqueBatchIds = (batchIds: Array<string>) =>
  Array.from(new Set(batchIds))

export const mergeSalesReportBatchIdsForRun = (input: {
  activeBatchIds: Array<string>
  selectedBatchIds: Array<string>
}) => uniqueBatchIds([...input.activeBatchIds, ...input.selectedBatchIds])

export const removeSalesReportBatchIdFromRun = (input: {
  activeBatchIds: Array<string>
  removedBatchId: string
}) =>
  uniqueBatchIds(input.activeBatchIds).filter(
    (batchId) => batchId !== input.removedBatchId,
  )

export const getConflictingActiveSalesReportBatchIds = (input: {
  reportId: string
  links: Array<ActiveSalesReportBatchLink>
}) =>
  Array.from(
    new Set(
      input.links
        .filter((link) => link.salesReportId !== input.reportId)
        .map((link) => link.batchId),
    ),
  )

const parseDetailPositiveInteger = (
  value: number | null | undefined,
  fallback: number,
) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const parseDetailPageSize = (value: number | null | undefined) => {
  const parsed = parseDetailPositiveInteger(
    value,
    DEFAULT_SALES_REPORT_DETAIL_PAGE_SIZE,
  )
  return SALES_REPORT_DETAIL_PAGE_SIZE_OPTIONS.includes(
    parsed as (typeof SALES_REPORT_DETAIL_PAGE_SIZE_OPTIONS)[number],
  )
    ? parsed
    : DEFAULT_SALES_REPORT_DETAIL_PAGE_SIZE
}

const buildDetailPagination = (input: {
  page: number
  pageSize: number
  totalItems: number
}): BatchListPagination => {
  const totalPages = Math.max(1, Math.ceil(input.totalItems / input.pageSize))

  return {
    page: input.page,
    pageSize: input.pageSize,
    totalItems: input.totalItems,
    totalPages,
    hasNextPage: input.page * input.pageSize < input.totalItems,
    hasPreviousPage: input.page > 1,
  }
}

const toIsoString = (value: Date | null | undefined) =>
  value?.toISOString() ?? null

const toReportName = (fileName: string) => {
  const baseName = fileName.trim().split(/[\\/]/u).pop() || 'Sales Report'
  return baseName.replace(/\.(xlsx|xls)$/iu, '').trim() || 'Sales Report'
}

const isExcelFileInput = (file: { name: string; type: string }) =>
  /\.(xlsx|xls)$/iu.test(file.name.trim()) ||
  EXCEL_MIME_TYPES.has(file.type.trim().toLowerCase())

const escapeLikePattern = (value: string) => value.replaceAll(/[%_\\]/g, '\\$&')

export const buildSalesReportRowSearchCondition = (
  searchTerm: string | null | undefined,
): SQL | undefined => {
  const query = searchTerm?.trim() ?? ''
  if (!query) {
    return undefined
  }

  const likeQuery = `%${escapeLikePattern(query)}%`
  const tinQuery = normalizeTinDigits(query)

  return sql`
    (
      concat_ws(
        ' ',
        ${salesReportRows.rowNumber}::text,
        coalesce(${salesReportRows.customerName}, ''),
        coalesce(${salesReportRows.tin}, ''),
        coalesce(${salesReportRows.invoiceNumber}, ''),
        coalesce(${salesReportRows.accountingDate}, ''),
        coalesce(${salesReportRows.transactionLineDescription}, ''),
        coalesce(${salesReportRows.issuerShortnameUsedForMatch}, ''),
        coalesce(${salesReportRows.derivedBillingMonthMMYY}, '')
      ) ilike ${likeQuery} escape '\\'
      ${
        tinQuery
          ? sql`or ${salesReportRows.tin} like ${`%${tinQuery}%`}`
          : sql``
      }
    )
  `
}

const getTinPrefix9 = (value: string | null | undefined) => {
  const normalized = normalizeTinDigits(value)
  return normalized && normalized.length >= 9 ? normalized.slice(0, 9) : null
}

const assertExcelFileInput = (file: { name: string; type: string }) => {
  if (!isExcelFileInput(file)) {
    throw new Error(
      'Only Excel sales report files (.xlsx, .xls) are supported.',
    )
  }
}

const buildSalesReportStorageKey = (input: {
  prefix: string
  entity: SalesReportEntitySnapshot
  reportId: string
  versionId: string
  sanitizedFileName: string
}) =>
  buildStorageKey(
    input.prefix,
    'entities',
    buildEntityStorageKey(input.entity),
    'sales-reports',
    input.reportId,
    'versions',
    input.versionId,
    input.sanitizedFileName,
  )

const mapEntityToSnapshot = (entity: {
  id: number
  shortName: string | null
  companyName: string | null
  tin: string | null
}): SalesReportEntitySnapshot => {
  const tin = entity.tin?.trim() ?? ''
  if (!getTinPrefix9(tin)) {
    throw new Error('Selected entity must have a valid TIN.')
  }

  return {
    id: entity.id,
    shortName: entity.shortName,
    companyName: entity.companyName,
    tin,
  }
}

const resolveEntitySnapshotById = async (entityId: number) => {
  const db = getDb()
  const entity = (
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

  if (!entity) {
    throw new Error('Selected entity was not found.')
  }

  return mapEntityToSnapshot(entity)
}

export const assertSalesReportFileNameMatchesEntity = (
  fileName: string,
  entity: Pick<SalesReportEntitySnapshot, 'shortName' | 'companyName'>,
) => {
  const match = fileName
    .trim()
    .match(/^(.+)_SALES_REPORT(?:_.+)?\.(xlsx|xls)$/iu)
  const prefix = match?.[1]?.trim()
  if (!prefix) {
    return
  }

  const normalizedPrefix = normalizeIssuerShortname(prefix)
  const entityCandidates = [entity.shortName, entity.companyName]
    .map((value) => normalizeIssuerShortname(value ?? ''))
    .filter(Boolean)

  if (
    normalizedPrefix &&
    entityCandidates.length > 0 &&
    !entityCandidates.includes(normalizedPrefix)
  ) {
    throw new Error(
      'Sales report filename entity prefix does not match the selected entity.',
    )
  }
}

const mapVersionView = (
  version: SalesReportVersionRecord | null | undefined,
): SalesReportVersionView | null => {
  if (!version) {
    return null
  }

  return {
    id: version.id,
    salesReportId: version.salesReportId,
    versionNumber: version.versionNumber,
    originalFileName: version.originalFileName,
    mimeType: version.mimeType,
    sizeBytes: version.sizeBytes,
    storageKey: version.storageKey,
    parseStatus: version.parseStatus as SalesReportVersionStatus,
    rowCount: version.rowCount,
    errorMessage: version.errorMessage,
    uploadedAt: toIsoString(version.uploadedAt),
    parsedAt: toIsoString(version.parsedAt),
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  }
}

const mapRunBatchView = (
  batch: Pick<SalesReportRunBatchRecord, 'batchId' | 'createdAt'> & {
    name?: string | null
    entityShortName?: string | null
    entityCompanyName?: string | null
    entityTin?: string | null
    totalFiles?: number | null
    closedAt?: Date | null
  },
): SalesReportRunBatchView => ({
  batchId: batch.batchId,
  name: batch.name ?? null,
  entityName:
    batch.entityShortName?.trim() ||
    batch.entityCompanyName?.trim() ||
    batch.entityTin?.trim() ||
    'Unassigned',
  totalFiles: Number(batch.totalFiles ?? 0),
  createdAt: toIsoString(batch.createdAt),
  closedAt: toIsoString(batch.closedAt),
})

const mapRunView = (
  run: SalesReportRunRecord,
  batches: Array<SalesReportRunBatchView> = [],
): SalesReportRunView => ({
  id: run.id,
  salesReportId: run.salesReportId,
  salesReportVersionId: run.salesReportVersionId,
  status: run.status as SalesReportRunView['status'],
  selectedBatchCount: run.selectedBatchCount,
  totalRows: run.totalRows,
  matchedCount: run.matchedCount,
  unmatchedCount: run.unmatchedCount,
  varianceTotal: roundMoney(run.varianceTotal),
  errorMessage: run.errorMessage,
  startedAt: run.startedAt.toISOString(),
  finishedAt: toIsoString(run.finishedAt),
  archivedAt: toIsoString(run.archivedAt),
  createdAt: run.createdAt.toISOString(),
  updatedAt: run.updatedAt.toISOString(),
  batches,
})

const mapReportListItem = (input: {
  report: SalesReportRecord
  version?: SalesReportVersionRecord | null
  latestRun?: SalesReportRunView | null
}): SalesReportListItem => ({
  id: input.report.id,
  name: input.report.name,
  status: input.report.status as SalesReportListItem['status'],
  entity: {
    id: input.report.entityId,
    shortName: input.report.entityShortName,
    companyName: input.report.entityCompanyName,
    tin: input.report.entityTin,
  },
  currentVersion: mapVersionView(input.version ?? null),
  latestRun: input.latestRun ?? null,
  createdAt: input.report.createdAt.toISOString(),
  updatedAt: input.report.updatedAt.toISOString(),
})

const mapRowView = (row: SalesReportRowRecord): SalesReportRowView => ({
  id: row.id,
  rowNumber: row.rowNumber,
  customerName: row.customerName,
  tin: row.tin,
  invoiceNumber: row.invoiceNumber,
  accountingDate: row.accountingDate,
  transactionLineDescription: row.transactionLineDescription,
  taxableSales: roundMoney(row.taxableSales),
  outputVAT: roundMoney(row.outputVAT),
  prepaidCWT: roundMoney(row.prepaidCWT),
  issuerShortnameUsedForMatch: row.issuerShortnameUsedForMatch,
  derivedBillingMonthMMYY: row.derivedBillingMonthMMYY,
})

const buildReportConditions = async (input: SalesReportListInput) => {
  const conditions: Array<SQL> = [isNull(salesReports.deletedAt)]
  const query = input.q.trim()

  if (input.entityId) {
    const entityFilter = await resolveEntityScopeFilterById(input.entityId)
    if (entityFilter) {
      conditions.push(eq(salesReports.entityId, entityFilter.id))
    } else {
      conditions.push(sql`false`)
    }
  }

  if (input.status !== 'all') {
    conditions.push(eq(salesReports.status, input.status))
  }

  if (query) {
    conditions.push(sql`
      concat_ws(
        ' ',
        coalesce(${salesReports.name}, ''),
        coalesce(${salesReports.entityShortName}, ''),
        coalesce(${salesReports.entityCompanyName}, ''),
        coalesce(${salesReports.entityTin}, '')
      ) ilike ${`%${escapeLikePattern(query)}%`} escape '\\'
    `)
  }

  return conditions
}

const buildSummaryConditions = async (input: SalesReportListInput) =>
  buildReportConditions({ ...input, status: 'all' })

const fetchRunsWithBatches = async (runs: Array<SalesReportRunRecord>) => {
  if (runs.length === 0) {
    return new Map<string, SalesReportRunView>()
  }

  const db = getDb()
  const runIds = runs.map((run) => run.id)
  const batchRows = await db
    .select({
      salesReportRunId: salesReportRunBatches.salesReportRunId,
      batchId: salesReportRunBatches.batchId,
      createdAt: salesReportRunBatches.createdAt,
      name: intakeBatches.name,
      entityShortName: intakeBatches.entityShortName,
      entityCompanyName: intakeBatches.entityCompanyName,
      entityTin: intakeBatches.entityTin,
      totalFiles: intakeBatches.totalFiles,
      closedAt: intakeBatches.closedAt,
    })
    .from(salesReportRunBatches)
    .leftJoin(
      intakeBatches,
      eq(salesReportRunBatches.batchId, intakeBatches.id),
    )
    .where(inArray(salesReportRunBatches.salesReportRunId, runIds))

  const batchesByRunId = new Map<string, Array<SalesReportRunBatchView>>()
  for (const row of batchRows) {
    const current = batchesByRunId.get(row.salesReportRunId) ?? []
    current.push(mapRunBatchView(row))
    batchesByRunId.set(row.salesReportRunId, current)
  }

  return new Map(
    runs.map((run) => [run.id, mapRunView(run, batchesByRunId.get(run.id))]),
  )
}

export const listSalesReports = async (
  input: SalesReportListInput,
): Promise<SalesReportListResponse> => {
  const db = getDb()
  const page = Math.max(1, input.page)
  const pageSize = Math.max(1, input.pageSize)
  const offset = (page - 1) * pageSize
  const conditions = await buildReportConditions(input)
  const summaryConditions = await buildSummaryConditions(input)

  const [totalRows, summaryRows, reports] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesReports)
      .where(and(...conditions)),
    db
      .select({
        status: salesReports.status,
        count: sql<number>`count(*)::int`,
      })
      .from(salesReports)
      .where(and(...summaryConditions))
      .groupBy(salesReports.status),
    db
      .select()
      .from(salesReports)
      .where(and(...conditions))
      .orderBy(desc(salesReports.updatedAt), desc(salesReports.createdAt))
      .limit(pageSize)
      .offset(offset),
  ])

  const totalItems = Number(totalRows.at(0)?.count ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const versionIds = reports
    .map((report) => report.currentVersionId)
    .filter((value): value is string => Boolean(value))
  const reportIds = reports.map((report) => report.id)
  const [versions, latestRuns] = await Promise.all([
    versionIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(salesReportVersions)
          .where(inArray(salesReportVersions.id, versionIds)),
    reportIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(salesReportRuns)
          .where(inArray(salesReportRuns.salesReportId, reportIds))
          .orderBy(desc(salesReportRuns.createdAt)),
  ])

  const versionById = new Map(versions.map((version) => [version.id, version]))
  const latestRunByReportId = new Map<string, SalesReportRunRecord>()
  for (const run of latestRuns) {
    if (!latestRunByReportId.has(run.salesReportId)) {
      latestRunByReportId.set(run.salesReportId, run)
    }
  }
  const runViewsById = await fetchRunsWithBatches(
    Array.from(latestRunByReportId.values()),
  )
  const summaryByStatus = new Map(
    summaryRows.map((row) => [row.status, Number(row.count)]),
  )

  return {
    reports: reports.map((report) => {
      const latestRun = latestRunByReportId.get(report.id)
      return mapReportListItem({
        report,
        version: report.currentVersionId
          ? versionById.get(report.currentVersionId)
          : null,
        latestRun: latestRun ? (runViewsById.get(latestRun.id) ?? null) : null,
      })
    }),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: page * pageSize < totalItems,
      hasPreviousPage: page > 1,
    },
    summary: {
      total: Array.from(summaryByStatus.values()).reduce(
        (total, count) => total + count,
        0,
      ),
      ready: summaryByStatus.get('ready') ?? 0,
      error: summaryByStatus.get('error') ?? 0,
      uploading: summaryByStatus.get('uploading') ?? 0,
    },
  }
}

const fetchReportRecord = async (reportId: string) => {
  const db = getDb()
  const report = (
    await db
      .select()
      .from(salesReports)
      .where(and(eq(salesReports.id, reportId), isNull(salesReports.deletedAt)))
      .limit(1)
  ).at(0)

  if (!report) {
    return null
  }

  const currentVersion = report.currentVersionId
    ? ((
        await db
          .select()
          .from(salesReportVersions)
          .where(eq(salesReportVersions.id, report.currentVersionId))
          .limit(1)
      ).at(0) ?? null)
    : null

  return {
    report,
    currentVersion,
  }
}

export const getSalesReportDetail = async (
  reportId: string,
  options: SalesReportDetailPaginationInput = {},
): Promise<SalesReportDetailView | null> => {
  const db = getDb()
  const record = await fetchReportRecord(reportId)
  if (!record) {
    return null
  }

  const { report, currentVersion } = record
  const rowsPage = parseDetailPositiveInteger(options.rowsPage, 1)
  const rowsPageSize = parseDetailPageSize(options.rowsPageSize)
  const resultsPage = parseDetailPositiveInteger(options.resultsPage, 1)
  const resultsPageSize = parseDetailPageSize(options.resultsPageSize)
  const rowsOffset = (rowsPage - 1) * rowsPageSize
  const rowConditions = currentVersion
    ? [
        eq(salesReportRows.salesReportVersionId, currentVersion.id),
        buildSalesReportRowSearchCondition(options.rowsQ),
      ].filter((condition): condition is SQL => Boolean(condition))
    : []
  const rowPredicate =
    rowConditions.length > 0 ? and(...rowConditions) : undefined

  const [rowCountRows, rows, runs, activeReconciliation] = await Promise.all([
    currentVersion
      ? db
          .select({ count: sql<number>`count(*)::int` })
          .from(salesReportRows)
          .where(rowPredicate)
      : Promise.resolve([{ count: 0 }]),
    currentVersion
      ? db
          .select()
          .from(salesReportRows)
          .where(rowPredicate)
          .orderBy(salesReportRows.rowNumber)
          .limit(rowsPageSize)
          .offset(rowsOffset)
      : Promise.resolve([]),
    db
      .select()
      .from(salesReportRuns)
      .where(eq(salesReportRuns.salesReportId, report.id))
      .orderBy(desc(salesReportRuns.createdAt))
      .limit(10),
    listReconciliationResults({
      salesReportId: report.id,
      q: options.q ?? undefined,
      filter: options.filter ?? undefined,
      page: resultsPage,
      pageSize: resultsPageSize,
    }),
  ])

  const runViewsById = await fetchRunsWithBatches(runs)
  const activeRun =
    runs
      .map((run) => runViewsById.get(run.id) ?? mapRunView(run))
      .find((run) => run.archivedAt === null) ?? null
  const rowTotalItems = Number(rowCountRows.at(0)?.count ?? 0)

  return {
    ...mapReportListItem({
      report,
      version: currentVersion,
      latestRun: runs.at(0)
        ? (runViewsById.get(runs[0].id) ?? mapRunView(runs[0]))
        : null,
    }),
    rows: rows.map(mapRowView),
    rowsPagination: buildDetailPagination({
      page: rowsPage,
      pageSize: rowsPageSize,
      totalItems: rowTotalItems,
    }),
    runs: runs.map((run) => runViewsById.get(run.id) ?? mapRunView(run)),
    activeRun,
    activeReconciliation,
  }
}

export const presignSalesReportUpload = async (input: {
  userId: string
  reportId?: string
  entityId: number
  name?: string
  file: {
    name: string
    type: string
    size: number
  }
}): Promise<SalesReportPresignResponse> => {
  assertExcelFileInput(input.file)
  const entity = await resolveEntitySnapshotById(input.entityId)
  assertSalesReportFileNameMatchesEntity(input.file.name, entity)

  const db = getDb()
  const bucket = getStorageBucketName()
  const prefix = getStoragePrefix()
  const reportId = input.reportId ?? randomUUID()
  const versionId = randomUUID()
  const now = new Date()
  const sanitizedFileName = sanitizeUploadFileName(input.file.name)
  const mimeType =
    input.file.type.trim() ||
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const storageKey = buildSalesReportStorageKey({
    prefix,
    entity,
    reportId,
    versionId,
    sanitizedFileName,
  })

  let report: SalesReportRecord
  let version: SalesReportVersionRecord

  if (input.reportId) {
    const current = await fetchReportRecord(input.reportId)
    if (!current) {
      throw new Error('Sales report not found.')
    }

    if (current.report.entityId !== entity.id) {
      throw new Error('Sales report updates must use the same entity.')
    }

    const maxVersion = (
      await db
        .select({
          value: sql<number>`coalesce(max(${salesReportVersions.versionNumber}), 0)::int`,
        })
        .from(salesReportVersions)
        .where(eq(salesReportVersions.salesReportId, input.reportId))
    ).at(0)?.value

    const insertedVersion = (
      await db
        .insert(salesReportVersions)
        .values({
          id: versionId,
          salesReportId: input.reportId,
          versionNumber: Number(maxVersion ?? 0) + 1,
          uploadedByUserId: input.userId,
          originalFileName: input.file.name,
          sanitizedFileName,
          mimeType,
          sizeBytes: input.file.size,
          storageBucket: bucket,
          storageKey,
          artifactUri: `s3://${bucket}/${storageKey}`,
          parseStatus: 'pending',
          uploadedAt: now,
        })
        .returning()
    ).at(0)

    const updatedReport = (
      await db
        .update(salesReports)
        .set({
          name: input.name?.trim() || current.report.name,
          status: 'uploading',
          currentVersionId: versionId,
          updatedAt: now,
        })
        .where(eq(salesReports.id, input.reportId))
        .returning()
    ).at(0)

    if (!insertedVersion || !updatedReport) {
      throw new Error('Unable to prepare sales report upload.')
    }

    report = updatedReport
    version = insertedVersion
  } else {
    const inserted = await db.transaction(async (tx) => {
      const createdReport = (
        await tx
          .insert(salesReports)
          .values({
            id: reportId,
            entityId: entity.id,
            entityShortName: entity.shortName,
            entityCompanyName: entity.companyName,
            entityTin: entity.tin,
            name: input.name?.trim() || toReportName(input.file.name),
            status: 'uploading',
            currentVersionId: versionId,
            createdByUserId: input.userId,
          })
          .returning()
      ).at(0)

      const createdVersion = (
        await tx
          .insert(salesReportVersions)
          .values({
            id: versionId,
            salesReportId: reportId,
            versionNumber: 1,
            uploadedByUserId: input.userId,
            originalFileName: input.file.name,
            sanitizedFileName,
            mimeType,
            sizeBytes: input.file.size,
            storageBucket: bucket,
            storageKey,
            artifactUri: `s3://${bucket}/${storageKey}`,
            parseStatus: 'pending',
            uploadedAt: now,
          })
          .returning()
      ).at(0)

      if (!createdReport || !createdVersion) {
        throw new Error('Unable to prepare sales report upload.')
      }

      return { createdReport, createdVersion }
    })

    report = inserted.createdReport
    version = inserted.createdVersion
  }

  const s3 = createS3ServerClient()
  const url = await getSignedUrl(
    s3 as never,
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      ContentType: mimeType,
    }) as never,
    { expiresIn: PRESIGN_EXPIRY_SECONDS },
  )

  return {
    report: mapReportListItem({ report, version }),
    upload: {
      reportId: report.id,
      versionId: version.id,
      fileName: input.file.name,
      sizeBytes: input.file.size,
      mimeType,
      storageKey,
      method: 'PUT',
      url,
      headers: {
        'content-type': mimeType,
      },
    },
  }
}

const readS3ObjectBuffer = async (input: {
  bucket: string
  key: string
  expectedMimeType: string
  expectedSizeBytes: number
}) => {
  const s3 = createS3ServerClient()
  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
    }),
  )

  const contentType = head.ContentType?.trim() || input.expectedMimeType
  const contentLength = Number(head.ContentLength ?? 0)
  if (!EXCEL_MIME_TYPES.has(contentType.toLowerCase())) {
    throw new Error('Uploaded object is not an Excel workbook.')
  }

  if (contentLength !== input.expectedSizeBytes) {
    throw new Error(
      `Uploaded object size mismatch. Expected ${input.expectedSizeBytes}, received ${contentLength}.`,
    )
  }

  const object = await s3.send(
    new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
    }),
  )
  const bodyTransformer = object.Body as
    | { transformToByteArray?: () => Promise<Uint8Array> }
    | undefined

  if (!bodyTransformer?.transformToByteArray) {
    throw new Error('Unexpected object body format.')
  }

  return Buffer.from(await bodyTransformer.transformToByteArray())
}

export const completeSalesReportUpload = async (input: {
  reportId: string
  versionId: string
}) => {
  const db = getDb()
  const version = (
    await db
      .select()
      .from(salesReportVersions)
      .where(
        and(
          eq(salesReportVersions.id, input.versionId),
          eq(salesReportVersions.salesReportId, input.reportId),
        ),
      )
      .limit(1)
  ).at(0)

  if (!version) {
    throw new Error('Sales report upload version not found.')
  }

  const report = (
    await db
      .select()
      .from(salesReports)
      .where(
        and(
          eq(salesReports.id, input.reportId),
          isNull(salesReports.deletedAt),
        ),
      )
      .limit(1)
  ).at(0)

  if (!report) {
    throw new Error('Sales report not found.')
  }

  const now = new Date()

  try {
    const buffer = await readS3ObjectBuffer({
      bucket: version.storageBucket,
      key: version.storageKey,
      expectedMimeType: version.mimeType,
      expectedSizeBytes: version.sizeBytes,
    })
    const parsedRows = parseReconciliationWorkbook(buffer, {
      maxRows: MAX_SALES_REPORT_ROWS,
      malformedBillingMonth: 'blank',
      missingTransactionLineDescription: 'blank',
    })
    if (parsedRows.length > MAX_SALES_REPORT_ROWS) {
      throw new Error(
        `Sales report workbook exceeds ${MAX_SALES_REPORT_ROWS} rows.`,
      )
    }
    assertSalesReportFileNameMatchesEntity(version.originalFileName, {
      shortName: report.entityShortName,
      companyName: report.entityCompanyName,
    })
    const rowInserts = parsedRows.map((row, index) => ({
      salesReportVersionId: version.id,
      rowNumber: index + 2,
      customerName: row.customerName,
      tin: row.tin,
      invoiceNumber: row.invoiceNumber,
      accountingDate: row.accountingDate,
      transactionLineDescription: row.transactionLineDescription,
      taxableSales: row.taxableSales,
      outputVAT: row.outputVAT,
      prepaidCWT: row.prepaidCWT,
      issuerShortnameUsedForMatch: row.issuerShortnameUsedForMatch,
      derivedBillingMonthMMYY: row.derivedBillingMonthMMYY,
    }))

    await db.transaction(async (tx) => {
      await tx
        .delete(salesReportRows)
        .where(eq(salesReportRows.salesReportVersionId, version.id))

      for (const chunk of chunkItems(rowInserts, BULK_INSERT_CHUNK_SIZE)) {
        await tx.insert(salesReportRows).values(chunk)
      }

      await tx
        .update(salesReportVersions)
        .set({
          parseStatus: 'ready',
          rowCount: parsedRows.length,
          errorMessage: null,
          parsedAt: now,
          updatedAt: now,
        })
        .where(eq(salesReportVersions.id, version.id))

      await tx
        .update(reconciliationResults)
        .set({
          archivedAt: now,
          archivedByUserId: version.uploadedByUserId,
          updatedAt: now,
        })
        .where(
          and(
            eq(reconciliationResults.salesReportId, report.id),
            ne(reconciliationResults.salesReportVersionId, version.id),
            isNull(reconciliationResults.archivedAt),
          ),
        )

      await tx
        .update(salesReportRuns)
        .set({
          status: 'archived',
          archivedAt: now,
          archivedByUserId: version.uploadedByUserId,
          updatedAt: now,
        })
        .where(
          and(
            eq(salesReportRuns.salesReportId, report.id),
            ne(salesReportRuns.salesReportVersionId, version.id),
            isNull(salesReportRuns.archivedAt),
          ),
        )

      await tx
        .update(salesReports)
        .set({
          status: 'ready',
          currentVersionId: version.id,
          updatedAt: now,
        })
        .where(eq(salesReports.id, report.id))
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.transaction(async (tx) => {
      await tx
        .update(salesReportVersions)
        .set({
          parseStatus: 'error',
          errorMessage: message,
          parsedAt: now,
          updatedAt: now,
        })
        .where(eq(salesReportVersions.id, version.id))

      await tx
        .update(salesReports)
        .set({
          status: 'error',
          updatedAt: now,
        })
        .where(eq(salesReports.id, report.id))
    })
  }

  const detail = await getSalesReportDetail(report.id)
  if (!detail) {
    throw new Error('Unable to load completed sales report.')
  }

  return detail
}

export const updateSalesReport = async (input: {
  reportId: string
  name: string
}) => {
  const db = getDb()
  const updated = (
    await db
      .update(salesReports)
      .set({
        name: input.name,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(salesReports.id, input.reportId),
          isNull(salesReports.deletedAt),
        ),
      )
      .returning()
  ).at(0)

  if (!updated) {
    return null
  }

  return getSalesReportDetail(updated.id)
}

export const deleteSalesReport = async (input: {
  reportId: string
  userId: string
}) => {
  const db = getDb()
  const now = new Date()

  const deleted = await db.transaction(async (tx) => {
    const updated = (
      await tx
        .update(salesReports)
        .set({
          status: 'deleted',
          deletedAt: now,
          deletedByUserId: input.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(salesReports.id, input.reportId),
            isNull(salesReports.deletedAt),
          ),
        )
        .returning()
    ).at(0)

    if (!updated) {
      return null
    }

    await tx
      .update(reconciliationResults)
      .set({
        archivedAt: now,
        archivedByUserId: input.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(reconciliationResults.salesReportId, input.reportId),
          isNull(reconciliationResults.archivedAt),
        ),
      )

    await tx
      .update(salesReportRuns)
      .set({
        status: 'archived',
        archivedAt: now,
        archivedByUserId: input.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(salesReportRuns.salesReportId, input.reportId),
          isNull(salesReportRuns.archivedAt),
        ),
      )

    return updated
  })

  return deleted !== null
}

const validateBatchesForRun = async (input: {
  report: SalesReportRecord
  batchIds: Array<string>
}) => {
  const batchIds = uniqueBatchIds(input.batchIds)
  if (batchIds.length === 0) {
    throw new Error('Select at least one closed upload batch.')
  }

  const db = getDb()
  const batches = await db
    .select()
    .from(intakeBatches)
    .where(
      and(
        inArray(intakeBatches.id, batchIds),
        isNull(intakeBatches.deletedAt),
      ),
    )

  if (batches.length !== batchIds.length) {
    throw new Error('One or more selected upload batches were not found.')
  }

  for (const batch of batches) {
    if (batch.status !== 'closed') {
      throw new Error('Only closed upload batches can be reconciled.')
    }

    if (batch.entityId !== input.report.entityId) {
      throw new Error(
        'All selected upload batches must belong to the sales report entity.',
      )
    }
  }

  const completedRows = await db
    .select({
      batchId: documentResults.batchId,
      count: sql<number>`count(*)::int`,
    })
    .from(documentResults)
    .where(
      and(
        inArray(documentResults.batchId, batchIds),
        eq(documentResults.status, 'success'),
      ),
    )
    .groupBy(documentResults.batchId)

  const completedBatchIds = new Set(completedRows.map((row) => row.batchId))
  if (batchIds.some((batchId) => !completedBatchIds.has(batchId))) {
    throw new Error(
      'Every selected upload batch must have completed extraction results.',
    )
  }

  const activeLinks = await fetchActiveSalesReportBatchLinks(batchIds)
  const conflictingBatchIds = getConflictingActiveSalesReportBatchIds({
    reportId: input.report.id,
    links: activeLinks,
  })
  if (conflictingBatchIds.length > 0) {
    throw new Error(
      'One or more selected batches are already reconciled in another sales report.',
    )
  }

  return batches
}

const fetchActiveSalesReportBatchLinks = async (
  batchIds: Array<string>,
): Promise<Array<ActiveSalesReportBatchLink>> => {
  const scopedBatchIds = uniqueBatchIds(batchIds)
  if (scopedBatchIds.length === 0) return []

  const db = getDb()
  return db
    .select({
      batchId: salesReportRunBatches.batchId,
      salesReportId: salesReportRuns.salesReportId,
    })
    .from(salesReportRunBatches)
    .innerJoin(
      salesReportRuns,
      eq(salesReportRunBatches.salesReportRunId, salesReportRuns.id),
    )
    .where(
      and(
        inArray(salesReportRunBatches.batchId, scopedBatchIds),
        isNull(salesReportRuns.archivedAt),
      ),
    )
}

const fetchActiveSalesReportBatchIds = async (reportId: string) => {
  const db = getDb()
  const rows = await db
    .select({
      batchId: salesReportRunBatches.batchId,
    })
    .from(salesReportRunBatches)
    .innerJoin(
      salesReportRuns,
      eq(salesReportRunBatches.salesReportRunId, salesReportRuns.id),
    )
    .where(
      and(
        eq(salesReportRuns.salesReportId, reportId),
        isNull(salesReportRuns.archivedAt),
      ),
    )

  return uniqueBatchIds(rows.map((row) => row.batchId))
}

const runSalesReportReconciliationWithBatchSet = async (input: {
  reportId: string
  batchIds: Array<string>
  userId: string
  mergeActiveBatches: boolean
}) => {
  const db = getDb()
  const record = await fetchReportRecord(input.reportId)
  if (!record) {
    throw new Error('Sales report not found.')
  }

  const { report, currentVersion } = record
  if (!currentVersion || currentVersion.parseStatus !== 'ready') {
    throw new Error('Sales report must finish parsing before reconciliation.')
  }

  const selectedBatchIds = uniqueBatchIds(input.batchIds)
  const activeBatchIds = input.mergeActiveBatches
    ? await fetchActiveSalesReportBatchIds(report.id)
    : []
  const batchIds = input.mergeActiveBatches
    ? mergeSalesReportBatchIdsForRun({ activeBatchIds, selectedBatchIds })
    : selectedBatchIds
  if (batchIds.length > MAX_SELECTED_BATCHES) {
    throw new Error(`Select ${MAX_SELECTED_BATCHES} batches or fewer.`)
  }
  await validateBatchesForRun({ report, batchIds })

  const rows = await db
    .select()
    .from(salesReportRows)
    .where(eq(salesReportRows.salesReportVersionId, currentVersion.id))
    .orderBy(salesReportRows.rowNumber)

  if (rows.length === 0) {
    throw new Error('Sales report has no parsed rows to reconcile.')
  }

  const run = (
    await db
      .insert(salesReportRuns)
      .values({
        salesReportId: report.id,
        salesReportVersionId: currentVersion.id,
        createdByUserId: input.userId,
        status: 'running',
        selectedBatchCount: batchIds.length,
        totalRows: rows.length,
        startedAt: new Date(),
      })
      .returning()
  ).at(0)

  if (!run) {
    throw new Error('Unable to start sales report reconciliation.')
  }

  try {
    await db.insert(salesReportRunBatches).values(
      batchIds.map((batchId) => ({
        salesReportRunId: run.id,
        batchId,
      })),
    )

    const masterlistLookup = await fetchMasterlistShortNameLookupForTins(
      rows.map((row) => row.tin),
    )

    const resolvedRows = rows.map((row) => {
      const masterlistIssuerShortname = resolveMasterlistIssuerShortnameByTin(
        row.tin,
        masterlistLookup,
      )

      return {
        ...row,
        masterlistIssuerShortname,
        issuerShortnameUsedForMatch:
          masterlistIssuerShortname ?? row.issuerShortnameUsedForMatch,
      }
    })

    const candidates = await fetchTaxRecordCandidates(resolvedRows, {
      uploadBatchIds: batchIds,
    })
    const completedAt = new Date()
    const insertRows = resolvedRows.map<ReconciliationInsert>((row) => {
      const matchShortName = row.issuerShortnameUsedForMatch
      const match = matchShortName
        ? pickBestTaxRecordMatch(
            {
              issuerShortnameUsedForMatch: matchShortName,
              derivedBillingMonthMMYY: row.derivedBillingMonthMMYY,
            },
            candidates,
          )
        : undefined
      const taxBase = match?.taxBase ?? null
      const taxWithheld = match?.taxWithheld ?? null
      const difference = buildDifferenceValues(
        taxBase,
        taxWithheld,
        row.taxableSales,
        row.prepaidCWT,
      )

      return {
        uploadBatchId: null,
        salesReportId: report.id,
        salesReportVersionId: currentVersion.id,
        salesReportRunId: run.id,
        salesReportRowId: row.id,
        matchedUploadBatchId: match?.batchId ?? null,
        requestingEntityShortName:
          report.entityShortName ?? report.entityCompanyName,
        customerName: row.customerName,
        tin: row.tin,
        invoiceNumber: row.invoiceNumber,
        accountingDate: row.accountingDate,
        transactionLineDescription: row.transactionLineDescription,
        taxableSales: row.taxableSales,
        outputVAT: row.outputVAT,
        prepaidCWT: row.prepaidCWT,
        issuerShortnameUsedForMatch: row.issuerShortnameUsedForMatch,
        derivedBillingMonthMMYY: row.derivedBillingMonthMMYY,
        matchedTaxRecordId: match?.taxRecordId ?? null,
        taxBase,
        taxWithheld,
        taxBaseDifference: difference.taxBaseDifference,
        taxWithheldDifference: difference.taxWithheldDifference,
        hasDifference: difference.hasDifference,
        matchStatus: match ? 'matched' : 'unmatched',
        matchedAt: match ? completedAt : null,
      }
    })
    const matchedCount = insertRows.filter(
      (row) => row.matchStatus === 'matched',
    ).length
    const varianceTotal = roundMoney(
      insertRows.reduce(
        (total, row) =>
          total +
          Math.abs(row.taxBaseDifference) +
          Math.abs(row.taxWithheldDifference),
        0,
      ),
    )

    await db.transaction(async (tx) => {
      await tx
        .update(reconciliationResults)
        .set({
          archivedAt: completedAt,
          archivedByUserId: input.userId,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(reconciliationResults.salesReportId, report.id),
            isNull(reconciliationResults.archivedAt),
          ),
        )

      await tx
        .update(salesReportRuns)
        .set({
          status: 'archived',
          archivedAt: completedAt,
          archivedByUserId: input.userId,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(salesReportRuns.salesReportId, report.id),
            ne(salesReportRuns.id, run.id),
            isNull(salesReportRuns.archivedAt),
          ),
        )

      for (const chunk of chunkItems(insertRows, BULK_INSERT_CHUNK_SIZE)) {
        await tx.insert(reconciliationResults).values(chunk)
      }

      await tx
        .update(salesReportRuns)
        .set({
          status: 'completed',
          selectedBatchCount: batchIds.length,
          totalRows: insertRows.length,
          matchedCount,
          unmatchedCount: insertRows.length - matchedCount,
          varianceTotal,
          finishedAt: completedAt,
          errorMessage: null,
          updatedAt: completedAt,
        })
        .where(eq(salesReportRuns.id, run.id))

      await tx
        .update(salesReports)
        .set({
          status: 'ready',
          updatedAt: completedAt,
        })
        .where(eq(salesReports.id, report.id))
    })
  } catch (error) {
    const failedAt = new Date()
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(salesReportRuns)
      .set({
        status: 'failed',
        errorMessage: message,
        finishedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(salesReportRuns.id, run.id))
    throw error
  }

  const detail = await getSalesReportDetail(report.id)
  if (!detail) {
    throw new Error('Unable to load reconciled sales report.')
  }

  return detail
}

export const runSalesReportReconciliation = async (input: {
  reportId: string
  batchIds: Array<string>
  userId: string
}) =>
  runSalesReportReconciliationWithBatchSet({
    ...input,
    mergeActiveBatches: true,
  })

export const removeSalesReportBatch = async (input: {
  reportId: string
  batchId: string
  userId: string
}) => {
  const record = await fetchReportRecord(input.reportId)
  if (!record) {
    return null
  }

  const activeBatchIds = await fetchActiveSalesReportBatchIds(input.reportId)
  if (!activeBatchIds.includes(input.batchId)) {
    throw new Error('Batch is not part of the active sales report run.')
  }

  const remainingBatchIds = removeSalesReportBatchIdFromRun({
    activeBatchIds,
    removedBatchId: input.batchId,
  })
  if (remainingBatchIds.length > 0) {
    return runSalesReportReconciliationWithBatchSet({
      reportId: input.reportId,
      batchIds: remainingBatchIds,
      userId: input.userId,
      mergeActiveBatches: false,
    })
  }

  const db = getDb()
  const archivedAt = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(reconciliationResults)
      .set({
        archivedAt,
        archivedByUserId: input.userId,
        updatedAt: archivedAt,
      })
      .where(
        and(
          eq(reconciliationResults.salesReportId, input.reportId),
          isNull(reconciliationResults.archivedAt),
        ),
      )

    await tx
      .update(salesReportRuns)
      .set({
        status: 'archived',
        archivedAt,
        archivedByUserId: input.userId,
        updatedAt: archivedAt,
      })
      .where(
        and(
          eq(salesReportRuns.salesReportId, input.reportId),
          isNull(salesReportRuns.archivedAt),
        ),
      )

    await tx
      .update(salesReports)
      .set({
        status: 'ready',
        updatedAt: archivedAt,
      })
      .where(eq(salesReports.id, input.reportId))
  })

  const detail = await getSalesReportDetail(input.reportId)
  if (!detail) {
    throw new Error('Unable to load sales report after removing batch.')
  }

  return detail
}

export const getSalesReportOriginalObject = async (reportId: string) => {
  const record = await fetchReportRecord(reportId)
  if (!record?.currentVersion) {
    return null
  }

  return record.currentVersion
}
