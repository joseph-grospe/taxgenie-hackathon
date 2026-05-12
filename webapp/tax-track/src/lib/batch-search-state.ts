import type { BatchAttentionFilter } from '@/lib/upload-intake-types'
import { parseEntityScopeId } from '@/lib/entity-scope'

export const BATCH_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export const DEFAULT_BATCH_PAGE_SIZE = 25

export const batchSigningStatusFilterValues = [
  'all',
  'unavailable',
  'unsigned',
  'partial',
  'signed',
] as const

export const batchAttentionFilterValues = [
  'all',
  'needs_attention',
  'clear',
] as const

export type BatchSigningStatusFilter =
  (typeof batchSigningStatusFilterValues)[number]

export type BatchRouteSearch = {
  q: string
  status: string
  entity: string
  entityId: string
  signingStatus: BatchSigningStatusFilter
  attention: BatchAttentionFilter
  page: number
  pageSize: number
}

export const defaultBatchSearch: BatchRouteSearch = {
  q: '',
  status: 'all',
  entity: '',
  entityId: '',
  signingStatus: 'all',
  attention: 'all',
  page: 1,
  pageSize: DEFAULT_BATCH_PAGE_SIZE,
}

const parseText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : ''

const parsePositiveInteger = (value: unknown, fallback: number) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const parseBatchPageSize = (value: unknown) => {
  const parsed = parsePositiveInteger(value, DEFAULT_BATCH_PAGE_SIZE)
  return BATCH_PAGE_SIZE_OPTIONS.includes(
    parsed as (typeof BATCH_PAGE_SIZE_OPTIONS)[number],
  )
    ? parsed
    : DEFAULT_BATCH_PAGE_SIZE
}

const isBatchSigningStatusFilter = (
  value: string,
): value is BatchSigningStatusFilter =>
  batchSigningStatusFilterValues.includes(value as BatchSigningStatusFilter)

const isBatchAttentionFilter = (value: string): value is BatchAttentionFilter =>
  batchAttentionFilterValues.includes(value as BatchAttentionFilter)

export const parseBatchSearch = (
  search: Record<string, unknown>,
): BatchRouteSearch => {
  const signingStatus = parseText(search.signingStatus)
  const attention = parseText(search.attention)

  return {
    q: parseText(search.q),
    status: parseText(search.status) || 'all',
    entity: parseText(search.entity),
    entityId: parseEntityScopeId(search.entityId),
    signingStatus: isBatchSigningStatusFilter(signingStatus)
      ? signingStatus
      : 'all',
    attention: isBatchAttentionFilter(attention) ? attention : 'all',
    page: Math.max(1, parsePositiveInteger(search.page, 1)),
    pageSize: parseBatchPageSize(search.pageSize),
  }
}

export const hasActiveBatchFilters = (search: BatchRouteSearch): boolean =>
  search.q.length > 0 ||
  search.status !== 'all' ||
  search.signingStatus !== 'all' ||
  search.attention !== 'all'

export const buildBatchListQueryParams = (search: BatchRouteSearch) => {
  const params = new URLSearchParams()

  if (search.q) params.set('q', search.q)
  if (search.status !== 'all') params.set('status', search.status)
  if (search.entityId) {
    params.set('entityId', search.entityId)
  } else if (search.entity) {
    params.set('entity', search.entity)
  }
  if (search.signingStatus !== 'all') {
    params.set('signingStatus', search.signingStatus)
  }
  if (search.attention !== 'all') params.set('attention', search.attention)

  params.set('page', String(search.page))
  params.set('pageSize', String(search.pageSize))

  return params
}
