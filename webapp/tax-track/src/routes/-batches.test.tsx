import { describe, expect, it } from 'vitest'

import {
  buildBatchListQueryParams,
  hasActiveBatchFilters,
  parseBatchSearch,
} from '@/lib/batch-search-state'
import {
  buildBatchFilesQueryParams,
  parseBatchFilesSearch,
} from '@/lib/batch-file-search-state'

describe('/batches route behavior', () => {
  it('hydrates URL search into filters and pagination', () => {
    const search = parseBatchSearch({
      q: 'april',
      status: 'Needs Review',
      entity: 'AESI',
      signingStatus: 'partial',
      attention: 'needs_attention',
      page: '3',
      pageSize: '50',
    })

    expect(search).toEqual({
      q: 'april',
      status: 'Needs Review',
      entity: 'AESI',
      signingStatus: 'partial',
      attention: 'needs_attention',
      page: 3,
      pageSize: 50,
    })
    expect(hasActiveBatchFilters(search)).toBe(true)
  })

  it('builds backend query params with safe pagination defaults', () => {
    const search = parseBatchSearch({
      status: 'Active',
      signingStatus: 'not-real',
      attention: 'clear',
      page: '-10',
      pageSize: '999',
    })

    const params = buildBatchListQueryParams(search)

    expect(search.signingStatus).toBe('all')
    expect(search.page).toBe(1)
    expect(search.pageSize).toBe(25)
    expect(params.toString()).toBe(
      'status=Active&attention=clear&page=1&pageSize=25',
    )
  })

  it('clears filters and resets the page', () => {
    const filtered = parseBatchSearch({
      q: 'april',
      status: 'Needs Review',
      entity: 'AESI',
      signingStatus: 'signed',
      attention: 'needs_attention',
      page: '4',
    })

    const cleared = parseBatchSearch({
      ...filtered,
      q: '',
      status: 'all',
      entity: '',
      signingStatus: 'all',
      attention: 'all',
      page: 1,
    })

    expect(hasActiveBatchFilters(cleared)).toBe(false)
    expect(cleared.page).toBe(1)
    expect(cleared.pageSize).toBe(25)
  })

  it('hydrates batch file query state for paginated detail tables', () => {
    const search = parseBatchFilesSearch({
      q: 'duplicate',
      status: 'duplicate',
      attention: 'open',
      page: '-4',
      pageSize: '999',
    })

    const params = buildBatchFilesQueryParams(search)

    expect(search).toEqual({
      q: 'duplicate',
      status: 'duplicate',
      attention: 'open',
      page: 1,
      pageSize: 25,
    })
    expect(params.toString()).toBe(
      'q=duplicate&status=duplicate&attention=open&page=1&pageSize=25',
    )
  })
})
