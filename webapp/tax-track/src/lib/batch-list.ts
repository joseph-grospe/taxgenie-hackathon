import type { BatchRouteSearch } from '@/lib/batch-search-state'
import type { EntityScopeFilter } from '@/lib/entity-scope'
import type {
  BatchListFilterOptions,
  BatchListResponse,
  BatchListRow,
  IntakeBatchView,
} from '@/lib/upload-intake-types'
import {
  BATCH_LIST_STATUS_FILTER_OPTIONS,
  BATCH_SIGNING_STATUS_FILTER_OPTIONS,
} from '@/lib/upload-intake-types'

export type BatchOwnerLookup = Map<
  string,
  {
    name: string | null
    email: string | null
  }
>

export type BuildBatchListOptions = Pick<
  BatchRouteSearch,
  'q' | 'status' | 'entity' | 'signingStatus' | 'attention'
> & {
  repository?: BatchRouteSearch['repository']
  entityId?: string | null
  page?: number | null
  pageSize?: number | null
  reconciliationEligible?: boolean
  ownersByUserId?: BatchOwnerLookup
  entityFilter?: EntityScopeFilter | null
}

const normalizeSearchText = (value: string | null | undefined) =>
  (value ?? '').trim().toLowerCase()

const getEntityName = (batch: IntakeBatchView) =>
  batch.entity?.shortName?.trim() ||
  batch.entity?.companyName?.trim() ||
  batch.entity?.tin?.trim() ||
  'Unassigned'

const getOwner = (
  batch: IntakeBatchView,
  ownersByUserId: BatchOwnerLookup | undefined,
) => {
  const owner = ownersByUserId?.get(batch.createdByUserId)
  const ownerName =
    owner?.name?.trim() || owner?.email?.trim() || batch.createdByUserId

  return {
    ownerName,
    ownerEmail: owner?.email?.trim() || null,
  }
}

const toBatchListRow = (
  batch: IntakeBatchView,
  ownersByUserId: BatchOwnerLookup | undefined,
): BatchListRow => {
  const { files: _files, ...batchFields } = batch
  const owner = getOwner(batch, ownersByUserId)

  return {
    ...batchFields,
    entityName: getEntityName(batch),
    ownerName: owner.ownerName,
    ownerEmail: owner.ownerEmail,
  }
}

const matchesSearch = (row: BatchListRow, query: string) => {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return true

  const haystack = [
    row.name,
    row.id,
    row.entityName,
    row.entity?.shortName,
    row.entity?.companyName,
    row.entity?.tin,
    row.ownerName,
    row.ownerEmail,
  ]
    .map((value) => normalizeSearchText(value))
    .join(' ')

  return haystack.includes(normalizedQuery)
}

const matchesEntity = (row: BatchListRow, entity: string) => {
  const normalizedEntity = normalizeSearchText(entity)
  if (!normalizedEntity) return true

  return (
    normalizeSearchText(row.entityName) === normalizedEntity ||
    normalizeSearchText(row.entity?.shortName) === normalizedEntity ||
    normalizeSearchText(row.entity?.companyName) === normalizedEntity
  )
}

const matchesEntityFilter = (
  row: BatchListRow,
  entityFilter: EntityScopeFilter | null | undefined,
) => {
  if (!entityFilter) return true

  return (
    row.entity?.id === entityFilter.id ||
    matchesEntity(row, entityFilter.shortName ?? '') ||
    matchesEntity(row, entityFilter.companyName ?? '')
  )
}

const filterRowsWithoutStatus = (
  rows: Array<BatchListRow>,
  input: BuildBatchListOptions,
) =>
  rows.filter((row) => {
    const matchesSigningStatus =
      input.signingStatus === 'all' ||
      row.batchSigningStatus === input.signingStatus
    const matchesAttention =
      input.attention === 'all' ||
      (input.attention === 'needs_attention'
        ? row.openAttentionCount > 0
        : row.openAttentionCount === 0)
    const matchesRepository =
      input.repository === 'deleted' ? Boolean(row.deletedAt) : !row.deletedAt

    return (
      matchesRepository &&
      matchesSearch(row, input.q) &&
      matchesEntityFilter(row, input.entityFilter) &&
      (!input.entityFilter ? matchesEntity(row, input.entity) : true) &&
      matchesSigningStatus &&
      matchesAttention
    )
  })

const filterRowsByStatus = (
  rows: Array<BatchListRow>,
  status: string | null | undefined,
) => {
  const normalizedStatus = normalizeSearchText(status)
  if (!normalizedStatus || normalizedStatus === 'all') return rows

  return rows.filter(
    (row) => normalizeSearchText(row.overallStatus) === normalizedStatus,
  )
}

const getBatchFilterOptions = (): BatchListFilterOptions => ({
  statuses: [...BATCH_LIST_STATUS_FILTER_OPTIONS],
  signingStatuses: [...BATCH_SIGNING_STATUS_FILTER_OPTIONS],
})

export const buildBatchListResponse = (
  batches: Array<IntakeBatchView>,
  input: BuildBatchListOptions,
): BatchListResponse => {
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.max(1, input.pageSize ?? 25)
  const rows = batches.map((batch) =>
    toBatchListRow(batch, input.ownersByUserId),
  )
  const filterOptions = getBatchFilterOptions()
  const matchingRows = filterRowsWithoutStatus(rows, input)
  const filteredRows = filterRowsByStatus(matchingRows, input.status)
  const totalItems = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const offset = (page - 1) * pageSize
  const pageRows = filteredRows.slice(offset, offset + pageSize)

  return {
    batches: pageRows,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: page * pageSize < totalItems,
      hasPreviousPage: page > 1,
    },
    summary: {
      total: matchingRows.length,
      active: matchingRows.filter((row) => row.overallStatus === 'Active')
        .length,
      errors: matchingRows.filter((row) => row.overallStatus === 'Error')
        .length,
      reviews: matchingRows.filter((row) => row.overallStatus === 'Review')
        .length,
      duplicates: matchingRows.filter(
        (row) => row.overallStatus === 'Duplicate',
      ).length,
      completed: matchingRows.filter((row) => row.overallStatus === 'Completed')
        .length,
    },
    filterOptions,
  }
}
