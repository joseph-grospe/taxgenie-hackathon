import type { ReferenceDataDataset } from '@/lib/reference-data'

export const REFERENCE_DATA_PAGE_SIZE_OPTIONS = [25, 50, 100] as const

export type ReferenceDataPageSize =
  (typeof REFERENCE_DATA_PAGE_SIZE_OPTIONS)[number]
export type ReferenceDataSortDirection = 'asc' | 'desc'
export type ReferenceDataCompletenessFilter = 'all' | 'present' | 'missing'
export type ReferenceDataGovernmentFilter = 'all' | 'yes' | 'no'
export type ReferenceDataSortKey =
  | 'customerName'
  | 'tin'
  | 'shortName'
  | 'entity'
  | 'region'
  | 'emailAddress'
  | 'isGovernment'
  | 'companyName'
  | 'zipCode'
  | 'regionEmailAddress'
  | 'code'
  | 'taxType'
  | 'description'
  | 'rate'

export type ReferenceDataRouteSearch = {
  dataset: ReferenceDataDataset
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
  pageSize: ReferenceDataPageSize
}

const datasetValues = new Set<ReferenceDataDataset>([
  'masterlist',
  'entities',
  'atc-codes',
])
const completenessValues = new Set<ReferenceDataCompletenessFilter>([
  'all',
  'present',
  'missing',
])
const governmentValues = new Set<ReferenceDataGovernmentFilter>([
  'all',
  'yes',
  'no',
])
const directionValues = new Set<ReferenceDataSortDirection>(['asc', 'desc'])

const sortKeysByDataset: Record<
  ReferenceDataDataset,
  ReadonlySet<ReferenceDataSortKey>
> = {
  masterlist: new Set([
    'customerName',
    'tin',
    'shortName',
    'entity',
    'region',
    'emailAddress',
    'isGovernment',
  ]),
  entities: new Set([
    'shortName',
    'companyName',
    'tin',
    'zipCode',
    'emailAddress',
    'regionEmailAddress',
  ]),
  'atc-codes': new Set(['code', 'taxType', 'description', 'rate']),
}

export const defaultReferenceDataSort: Record<
  ReferenceDataDataset,
  ReferenceDataSortKey
> = {
  masterlist: 'customerName',
  entities: 'shortName',
  'atc-codes': 'code',
}

const parseText = (value: unknown) =>
  typeof value === 'string' ? value.trim().slice(0, 1_000) : ''

const parsePositiveInteger = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

const parseDataset = (value: unknown): ReferenceDataDataset => {
  const candidate = parseText(value) as ReferenceDataDataset
  return datasetValues.has(candidate) ? candidate : 'masterlist'
}

const parsePageSize = (value: unknown): ReferenceDataPageSize => {
  const parsed = parsePositiveInteger(value, 25)
  return REFERENCE_DATA_PAGE_SIZE_OPTIONS.includes(
    parsed as ReferenceDataPageSize,
  )
    ? (parsed as ReferenceDataPageSize)
    : 25
}

const parseRate = (value: unknown) => {
  const text = parseText(value)
  if (!text) return ''

  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : ''
}

export const parseReferenceDataSearch = (
  search: Record<string, unknown>,
): ReferenceDataRouteSearch => {
  const dataset = parseDataset(search.dataset)
  const requestedSort = parseText(search.sort) as ReferenceDataSortKey
  const requestedDirection = parseText(
    search.direction,
  ) as ReferenceDataSortDirection
  const requestedGovernment = parseText(
    search.government,
  ) as ReferenceDataGovernmentFilter
  const requestedTinState = parseText(
    search.tinState,
  ) as ReferenceDataCompletenessFilter
  const requestedEmailState = parseText(
    search.emailState,
  ) as ReferenceDataCompletenessFilter
  const hasSupportedSort = sortKeysByDataset[dataset].has(requestedSort)

  return {
    dataset,
    q: parseText(search.q).slice(0, 200),
    region: dataset === 'masterlist' ? parseText(search.region) : '',
    entity: dataset === 'masterlist' ? parseText(search.entity) : '',
    government:
      dataset === 'masterlist' && governmentValues.has(requestedGovernment)
        ? requestedGovernment
        : 'all',
    tinState:
      dataset === 'entities' && completenessValues.has(requestedTinState)
        ? requestedTinState
        : 'all',
    emailState:
      dataset === 'entities' && completenessValues.has(requestedEmailState)
        ? requestedEmailState
        : 'all',
    taxType: dataset === 'atc-codes' ? parseText(search.taxType) : '',
    rate: dataset === 'atc-codes' ? parseRate(search.rate) : '',
    sort: hasSupportedSort ? requestedSort : defaultReferenceDataSort[dataset],
    direction:
      hasSupportedSort && directionValues.has(requestedDirection)
        ? requestedDirection
        : 'asc',
    page: parsePositiveInteger(search.page, 1),
    pageSize: parsePageSize(search.pageSize),
  }
}

export const buildReferenceDataQueryParams = (
  search: ReferenceDataRouteSearch,
) => {
  const params = new URLSearchParams({
    page: String(search.page),
    pageSize: String(search.pageSize),
    sort: search.sort,
    direction: search.direction,
  })

  if (search.q) params.set('q', search.q)
  if (search.region) params.set('region', search.region)
  if (search.entity) params.set('entity', search.entity)
  if (search.government !== 'all') {
    params.set('government', search.government)
  }
  if (search.tinState !== 'all') params.set('tinState', search.tinState)
  if (search.emailState !== 'all') {
    params.set('emailState', search.emailState)
  }
  if (search.taxType) params.set('taxType', search.taxType)
  if (search.rate) params.set('rate', search.rate)

  return params
}

export const switchReferenceDataDataset = (
  search: ReferenceDataRouteSearch,
  dataset: ReferenceDataDataset,
) =>
  parseReferenceDataSearch({
    dataset,
    q: search.q,
    pageSize: search.pageSize,
  })

export const getActiveReferenceDataFilterCount = (
  search: ReferenceDataRouteSearch,
) => {
  if (search.dataset === 'masterlist') {
    return [
      search.region,
      search.entity,
      search.government !== 'all' ? search.government : '',
    ].filter(Boolean).length
  }

  if (search.dataset === 'entities') {
    return [
      search.tinState !== 'all' ? search.tinState : '',
      search.emailState !== 'all' ? search.emailState : '',
    ].filter(Boolean).length
  }

  return [search.taxType, search.rate].filter(Boolean).length
}
