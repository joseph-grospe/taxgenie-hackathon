import type { AuditEventType, AuditTargetType } from '@/lib/audit-types'
import { isAuditEventType, isAuditTargetType } from '@/lib/audit-types'

export const AUDIT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
export const DEFAULT_AUDIT_PAGE_SIZE = 25
export const MANILA_TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1000

export type AuditActionFilter = AuditEventType | 'all'
export type AuditTargetTypeFilter = AuditTargetType | 'all'

export type AuditRouteSearch = {
  q: string
  action: AuditActionFilter
  actor: string
  targetType: AuditTargetTypeFilter
  dateFrom: string
  dateTo: string
  page: number
  pageSize: number
}

export const defaultAuditSearch: AuditRouteSearch = {
  q: '',
  action: 'all',
  actor: '',
  targetType: 'all',
  dateFrom: '',
  dateTo: '',
  page: 1,
  pageSize: DEFAULT_AUDIT_PAGE_SIZE,
}

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const parseText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : ''

const parsePositiveInteger = (value: unknown, fallback: number) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const parseAuditPageSize = (value: unknown) => {
  const parsed = parsePositiveInteger(value, DEFAULT_AUDIT_PAGE_SIZE)
  return AUDIT_PAGE_SIZE_OPTIONS.includes(
    parsed as (typeof AUDIT_PAGE_SIZE_OPTIONS)[number],
  )
    ? parsed
    : DEFAULT_AUDIT_PAGE_SIZE
}

export const parseAuditSearch = (
  search: Record<string, unknown>,
): AuditRouteSearch => {
  const action = parseText(search.action)
  const targetType = parseText(search.targetType)
  const dateFrom = parseText(search.dateFrom)
  const dateTo = parseText(search.dateTo)

  return {
    q: parseText(search.q),
    action: isAuditEventType(action) ? action : 'all',
    actor: parseText(search.actor),
    targetType: isAuditTargetType(targetType) ? targetType : 'all',
    dateFrom: DATE_INPUT_PATTERN.test(dateFrom) ? dateFrom : '',
    dateTo: DATE_INPUT_PATTERN.test(dateTo) ? dateTo : '',
    page: Math.max(1, parsePositiveInteger(search.page, 1)),
    pageSize: parseAuditPageSize(search.pageSize),
  }
}

export const buildAuditEventQueryParams = (search: AuditRouteSearch) => {
  const params = new URLSearchParams()

  if (search.q) params.set('q', search.q)
  if (search.action !== 'all') params.set('action', search.action)
  if (search.actor) params.set('actor', search.actor)
  if (search.targetType !== 'all') params.set('targetType', search.targetType)
  if (search.dateFrom) params.set('dateFrom', search.dateFrom)
  if (search.dateTo) params.set('dateTo', search.dateTo)

  params.set('page', String(search.page))
  params.set('pageSize', String(search.pageSize))

  return params
}

const parseDateParts = (value: string) => {
  if (!DATE_INPUT_PATTERN.test(value)) {
    return null
  }

  const [year, month, day] = value.split('-').map((part) => Number(part))
  const startUtcMs = Date.UTC(year, month - 1, day) - MANILA_TIME_ZONE_OFFSET_MS
  const manilaDate = new Date(startUtcMs + MANILA_TIME_ZONE_OFFSET_MS)

  if (
    manilaDate.getUTCFullYear() !== year ||
    manilaDate.getUTCMonth() !== month - 1 ||
    manilaDate.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day }
}

export const getManilaDayBoundary = (
  value: string,
  boundary: 'start' | 'end',
) => {
  const parts = parseDateParts(value)
  if (!parts) {
    return null
  }

  const startUtcMs =
    Date.UTC(parts.year, parts.month - 1, parts.day) -
    MANILA_TIME_ZONE_OFFSET_MS

  return new Date(
    boundary === 'start' ? startUtcMs : startUtcMs + 24 * 60 * 60 * 1000 - 1,
  )
}
