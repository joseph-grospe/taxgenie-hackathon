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
      entityId: '42',
      view: 'recentlyDeleted',
      signingStatus: 'partial',
      attention: 'needs_attention',
      page: '3',
      pageSize: '50',
    })

    expect(search).toEqual({
      q: 'april',
      status: 'Needs Review',
      entity: 'AESI',
      entityId: '42',
      repository: 'deleted',
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
      entityId: '7',
      page: '-10',
      pageSize: '999',
    })

    const params = buildBatchListQueryParams(search)

    expect(search.signingStatus).toBe('all')
    expect(search.page).toBe(1)
    expect(search.pageSize).toBe(25)
    expect(params.toString()).toBe(
      'status=Active&entityId=7&attention=clear&page=1&pageSize=25',
    )
  })

  it('clears filters and resets the page', () => {
    const filtered = parseBatchSearch({
      q: 'april',
      status: 'Needs Review',
      entity: 'AESI',
      entityId: '42',
      signingStatus: 'signed',
      attention: 'needs_attention',
      page: '4',
    })

    const cleared = parseBatchSearch({
      ...filtered,
      q: '',
      status: 'all',
      entity: '',
      entityId: '42',
      repository: 'deleted',
      signingStatus: 'all',
      attention: 'all',
      page: 1,
    })

    expect(hasActiveBatchFilters(cleared)).toBe(false)
    expect(cleared.entityId).toBe('42')
    expect(cleared.repository).toBe('deleted')
    expect(cleared.page).toBe(1)
    expect(cleared.pageSize).toBe(25)
  })

  it('builds Recently Deleted query params only for deleted batches', () => {
    const active = parseBatchSearch({ repository: 'active' })
    const deleted = parseBatchSearch({ repository: 'deleted' })

    expect(buildBatchListQueryParams(active).toString()).toBe(
      'page=1&pageSize=25',
    )
    expect(buildBatchListQueryParams(deleted).toString()).toBe(
      'view=recentlyDeleted&page=1&pageSize=25',
    )
  })

  it('keeps the legacy repository deleted search value working', () => {
    expect(parseBatchSearch({ repository: 'deleted' }).repository).toBe(
      'deleted',
    )
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
