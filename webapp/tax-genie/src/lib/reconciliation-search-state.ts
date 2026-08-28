import type { ReconciliationTableFilterValue } from '@/lib/reconciliation-table-state'

import { parseEntityScopeId } from '@/lib/entity-scope'
import {
  reconciliationPageSizeOptions,
  reconciliationTableFilterOptions,
} from '@/lib/reconciliation-table-state'

export type ReconciliationRouteSearch = {
  q: string
  filter: ReconciliationTableFilterValue
  entityId: string
  page: number
  pageSize: number
}

export const defaultReconciliationSearch: ReconciliationRouteSearch = {
  q: '',
  filter: 'all',
  entityId: '',
  page: 1,
  pageSize: 25,
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

const isReconciliationFilter = (
  value: string,
): value is ReconciliationTableFilterValue =>
  reconciliationTableFilterOptions.some((option) => option.value === value)

const parsePageSize = (value: unknown) => {
  const parsed = parsePositiveInteger(value, defaultReconciliationSearch.pageSize)
  return reconciliationPageSizeOptions.includes(
    String(parsed) as (typeof reconciliationPageSizeOptions)[number],
  )
    ? parsed
    : defaultReconciliationSearch.pageSize
}

export const parseReconciliationSearch = (
  search: Record<string, unknown>,
): ReconciliationRouteSearch => {
  const filter = parseText(search.filter)

  return {
    q: parseText(search.q),
    filter: isReconciliationFilter(filter) ? filter : 'all',
    entityId: parseEntityScopeId(search.entityId),
    page: Math.max(1, parsePositiveInteger(search.page, 1)),
    pageSize: parsePageSize(search.pageSize),
  }
}

export const buildReconciliationQueryParams = (
  search: ReconciliationRouteSearch,
) => {
  const params = new URLSearchParams()

  if (search.q) params.set('q', search.q)
  if (search.filter !== 'all') params.set('filter', search.filter)
  if (search.entityId) params.set('entityId', search.entityId)
  params.set('page', String(search.page))
  params.set('pageSize', String(search.pageSize))

  return params
}
