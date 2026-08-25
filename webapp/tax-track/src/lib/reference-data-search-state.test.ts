import { describe, expect, it } from 'vitest'

import {
  buildReferenceDataQueryParams,
  getActiveReferenceDataFilterCount,
  parseReferenceDataSearch,
  switchReferenceDataDataset,
} from '@/lib/reference-data-search-state'

describe('reference data search state', () => {
  it('normalizes invalid values to the masterlist defaults', () => {
    expect(
      parseReferenceDataSearch({
        dataset: 'invalid',
        page: -2,
        pageSize: 999,
        sort: 'rate',
        direction: 'sideways',
      }),
    ).toEqual(
      expect.objectContaining({
        dataset: 'masterlist',
        page: 1,
        pageSize: 25,
        sort: 'customerName',
        direction: 'asc',
      }),
    )
  })

  it('resets direction when the sort key is irrelevant to the dataset', () => {
    expect(
      parseReferenceDataSearch({
        dataset: 'masterlist',
        sort: 'rate',
        direction: 'desc',
      }),
    ).toEqual(
      expect.objectContaining({ sort: 'customerName', direction: 'asc' }),
    )
  })

  it('keeps only filters and sort keys supported by the active dataset', () => {
    const search = parseReferenceDataSearch({
      dataset: 'entities',
      region: 'NCR',
      government: 'yes',
      tinState: 'missing',
      emailState: 'present',
      taxType: 'WE',
      sort: 'companyName',
      direction: 'desc',
    })

    expect(search).toEqual(
      expect.objectContaining({
        region: '',
        government: 'all',
        tinState: 'missing',
        emailState: 'present',
        taxType: '',
        sort: 'companyName',
        direction: 'desc',
      }),
    )
    expect(getActiveReferenceDataFilterCount(search)).toBe(2)
  })

  it('switches datasets while preserving the shared query and page size', () => {
    const current = parseReferenceDataSearch({
      dataset: 'masterlist',
      q: 'Aboitiz',
      region: 'NCR',
      page: 4,
      pageSize: 50,
    })

    expect(switchReferenceDataDataset(current, 'atc-codes')).toEqual(
      expect.objectContaining({
        dataset: 'atc-codes',
        q: 'Aboitiz',
        page: 1,
        pageSize: 50,
        region: '',
        sort: 'code',
      }),
    )
  })

  it('serializes active filters, sorting, and pagination', () => {
    const params = buildReferenceDataQueryParams(
      parseReferenceDataSearch({
        dataset: 'atc-codes',
        q: 'services',
        taxType: 'WE',
        rate: '0.02',
        sort: 'rate',
        direction: 'desc',
        page: 3,
        pageSize: 100,
      }),
    )

    expect(Object.fromEntries(params)).toEqual({
      page: '3',
      pageSize: '100',
      sort: 'rate',
      direction: 'desc',
      q: 'services',
      taxType: 'WE',
      rate: '0.02',
    })
  })
})
