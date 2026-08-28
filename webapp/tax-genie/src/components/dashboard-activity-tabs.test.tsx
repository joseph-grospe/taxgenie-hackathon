/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardBatchRow } from '@/lib/dashboard-types'
import type { ValidatedTableRow } from '@/lib/validated-table-model'

import { DashboardActivityTabs } from '@/components/dashboard-activity-tabs'
import { defaultValidatedRouteSearch } from '@/lib/validated-search-state'

vi.mock('@/components/dashboard-batches-table', () => ({
  DashboardBatchesTable: ({
    loading,
    presentation,
  }: {
    loading?: boolean
    presentation?: string
  }) => (
    <section
      data-testid="batches-table"
      data-loading={loading}
      data-presentation={presentation}
    >
      <label htmlFor="batches-filter">Batch filter</label>
      <input id="batches-filter" defaultValue="" />
    </section>
  ),
}))

vi.mock('@/components/dashboard-validated-documents-table', () => ({
  DashboardValidatedDocumentsTable: ({
    loading,
    presentation,
  }: {
    loading?: boolean
    presentation?: string
  }) => (
    <section
      data-testid="validated-table"
      data-loading={loading}
      data-presentation={presentation}
    >
      <label htmlFor="validated-filter">Document filter</label>
      <input id="validated-filter" defaultValue="" />
    </section>
  ),
}))

const batches = [{}, {}] as Array<DashboardBatchRow>
const validatedDocuments = [{}, {}, {}] as Array<ValidatedTableRow>

const renderActivityTabs = ({
  loading = false,
  empty = false,
}: {
  loading?: boolean
  empty?: boolean
} = {}) =>
  render(
    <DashboardActivityTabs
      batches={empty ? [] : batches}
      batchFilterOptions={{ statuses: [] }}
      validatedDocuments={empty ? [] : validatedDocuments}
      validatedFilterOptions={{ statuses: [], atc: [] }}
      validatedSearch={defaultValidatedRouteSearch}
      onValidatedSearchChange={vi.fn()}
      loading={loading}
    />,
  )

afterEach(cleanup)

describe('DashboardActivityTabs', () => {
  it('defaults to recent batches, displays dynamic counts, and embeds both tables', () => {
    renderActivityTabs()

    expect(
      screen
        .getByRole('tab', { name: 'Recent Batches · 2' })
        .getAttribute('aria-selected'),
    ).toBe('true')
    expect(
      screen
        .getByRole('tab', { name: 'Validated Documents · 3' })
        .getAttribute('aria-selected'),
    ).toBe('false')
    expect(screen.getByTestId('batches-table').dataset.presentation).toBe(
      'embedded',
    )
    expect(screen.getByTestId('validated-table').dataset.presentation).toBe(
      'embedded',
    )
    expect(
      screen
        .getByTestId('validated-table')
        .closest('[role="tabpanel"]')
        ?.hasAttribute('hidden'),
    ).toBe(true)
  })

  it('supports keyboard tab switching and keeps local filter state mounted', () => {
    renderActivityTabs()

    const batchesTab = screen.getByRole('tab', { name: 'Recent Batches · 2' })
    const validatedTab = screen.getByRole('tab', {
      name: 'Validated Documents · 3',
    })

    batchesTab.focus()
    fireEvent.keyDown(batchesTab, {
      code: 'ArrowRight',
      key: 'ArrowRight',
    })
    expect(validatedTab.tabIndex).toBe(0)

    // Browsers translate Enter on the focused button into this click; jsdom does not.
    fireEvent.click(validatedTab)
    expect(validatedTab.getAttribute('aria-selected')).toBe('true')

    fireEvent.change(screen.getByLabelText('Document filter'), {
      target: { value: 'Aboitiz' },
    })
    fireEvent.click(batchesTab)
    fireEvent.click(validatedTab)

    expect(screen.getByLabelText('Document filter').value).toBe('Aboitiz')
  })

  it('passes loading state while retaining explicit empty counts', () => {
    renderActivityTabs({ loading: true, empty: true })

    expect(screen.getByRole('tab', { name: 'Recent Batches · 0' })).toBeTruthy()
    expect(
      screen.getByRole('tab', { name: 'Validated Documents · 0' }),
    ).toBeTruthy()
    expect(screen.getByTestId('batches-table').dataset.loading).toBe('true')
    expect(screen.getByTestId('validated-table').dataset.loading).toBe('true')
  })
})
