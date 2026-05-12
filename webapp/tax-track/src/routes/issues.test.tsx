import { describe, expect, it } from 'vitest'

import {
  buildIssueDocumentsQueryParams,
  hasActiveIssueFilters,
  parseIssueSearch,
} from '@/lib/issue-search-state'

describe('/issues route behavior', () => {
  it('hydrates URL search into filters and pagination', () => {
    const search = parseIssueSearch({
      status: 'duplicate',
      q: 'missing tin',
      severity: 'High',
      owner: 'Revenue Ops',
      entity: 'AESI',
      entityId: '42',
      year: '2025',
      month: 'December',
      quarter: 'Q4',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-08',
      page: '3',
      pageSize: '50',
    })

    expect(search).toEqual({
      status: 'duplicate',
      q: 'missing tin',
      severity: 'High',
      owner: 'Revenue Ops',
      entity: 'AESI',
      entityId: '42',
      year: '2025',
      month: 'December',
      quarter: 'Q4',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-08',
      page: 3,
      pageSize: 50,
    })
    expect(hasActiveIssueFilters(search)).toBe(true)
  })

  it('builds backend query params with safe pagination defaults', () => {
    const search = parseIssueSearch({
      status: 'unknown',
      entity: 'AESI',
      entityId: '7',
      year: '2025',
      month: 'December',
      quarter: 'Q4',
      page: '-10',
      pageSize: '999',
      dateFrom: 'not-a-date',
    })

    const params = buildIssueDocumentsQueryParams(search)

    expect(search.status).toBe('all')
    expect(search.page).toBe(1)
    expect(search.pageSize).toBe(25)
    expect(search.dateFrom).toBe('')
    expect(params.toString()).toBe(
      'entityId=7&year=2025&month=December&quarter=Q4&page=1&pageSize=25',
    )
  })
})
