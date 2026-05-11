import type {
  BatchFileAttentionFilter,
  BatchFileStatusFilter,
} from '@/lib/upload-intake-types'

export const BATCH_FILE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export const DEFAULT_BATCH_FILE_PAGE_SIZE = 25
export const DEFAULT_BATCH_ATTENTION_PAGE_SIZE = 10

export const batchFileStatusFilterValues = [
  'all',
  'pending',
  'uploaded',
  'queued',
  'processing',
  'success',
  'duplicate',
  'error',
] as const

export const batchFileAttentionFilterValues = ['all', 'open'] as const

export type BatchFilesSearch = {
  q: string
  status: BatchFileStatusFilter
  attention: BatchFileAttentionFilter
  page: number
  pageSize: number
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

const isBatchFileStatusFilter = (
  value: string,
): value is BatchFileStatusFilter =>
  batchFileStatusFilterValues.includes(value as BatchFileStatusFilter)

const isBatchFileAttentionFilter = (
  value: string,
): value is BatchFileAttentionFilter =>
  batchFileAttentionFilterValues.includes(value as BatchFileAttentionFilter)

export const parseBatchFilePageSize = (value: unknown) => {
  const parsed = parsePositiveInteger(value, DEFAULT_BATCH_FILE_PAGE_SIZE)
  return BATCH_FILE_PAGE_SIZE_OPTIONS.includes(
    parsed as (typeof BATCH_FILE_PAGE_SIZE_OPTIONS)[number],
  )
    ? parsed
    : DEFAULT_BATCH_FILE_PAGE_SIZE
}

export const parseBatchFilesSearch = (
  search: Record<string, unknown>,
): BatchFilesSearch => {
  const status = parseText(search.status)
  const attention = parseText(search.attention)

  return {
    q: parseText(search.q),
    status: isBatchFileStatusFilter(status) ? status : 'all',
    attention: isBatchFileAttentionFilter(attention) ? attention : 'all',
    page: Math.max(1, parsePositiveInteger(search.page, 1)),
    pageSize: parseBatchFilePageSize(search.pageSize),
  }
}

export const buildBatchFilesQueryParams = (search: BatchFilesSearch) => {
  const params = new URLSearchParams()

  if (search.q) params.set('q', search.q)
  if (search.status !== 'all') params.set('status', search.status)
  if (search.attention !== 'all') params.set('attention', search.attention)
  params.set('page', String(search.page))
  params.set('pageSize', String(search.pageSize))

  return params
}
