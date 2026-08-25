/* @vitest-environment jsdom */

import * as React from 'react'
import { screen, within } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'

import { DashboardBatchesTable } from '@/components/dashboard-batches-table'
import { DashboardValidatedDocumentsTable } from '@/components/dashboard-validated-documents-table'
import { defaultValidatedRouteSearch } from '@/lib/validated-search-state'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('@/components/status-pill', () => ({
  StatusPill: ({ status }: { status: string }) => <span>{status}</span>,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectGroup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
}))

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = []

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const renderTable = async (node: React.ReactNode) => {
  const container = document.createElement('div')
  const root = createRoot(container)
  document.body.append(container)
  mountedRoots.push({ container, root })

  await React.act(() => {
    root.render(node)
  })

  return { container }
}

afterEach(async () => {
  for (const { container, root } of mountedRoots.splice(0)) {
    await React.act(() => {
      root.unmount()
    })
    container.remove()
  }
})

describe('dashboard table presentation', () => {
  it('embeds recent batches without a nested card and retains controls and empty state', async () => {
    await renderTable(
      <DashboardBatchesTable
        rows={[]}
        filterOptions={{ statuses: [] }}
        presentation="embedded"
      />,
    )

    const region = screen.getByRole('region', { name: 'Recent batches' })

    expect(region.querySelector('[data-slot="card"]')).toBeNull()
    expect(within(region).getByPlaceholderText('Search batch')).toBeTruthy()
    expect(
      within(region).getByText('No 2307 batches found for this period.'),
    ).toBeTruthy()
    expect(within(region).getByText('Showing 0 to 0 of 0 batches')).toBeTruthy()
  })

  it('embeds validated documents without a nested card and retains controls and empty state', async () => {
    await renderTable(
      <DashboardValidatedDocumentsTable
        rows={[]}
        filterOptions={{ statuses: [], atc: [] }}
        search={defaultValidatedRouteSearch}
        onSearchChange={vi.fn()}
        presentation="embedded"
      />,
    )

    const region = screen.getByRole('region', {
      name: 'Validated documents',
    })

    expect(region.querySelector('[data-slot="card"]')).toBeNull()
    expect(within(region).getByPlaceholderText('Search customer')).toBeTruthy()
    expect(
      within(region).getByText('No validated documents found for this period.'),
    ).toBeTruthy()
    expect(
      within(region).getByText('Showing 0 to 0 of 0 documents'),
    ).toBeTruthy()
  })

  it('keeps standalone presentation as the default', async () => {
    const { container } = await renderTable(
      <DashboardBatchesTable rows={[]} filterOptions={{ statuses: [] }} />,
    )

    expect(container.querySelector('[data-slot="card"]')).toBeTruthy()
    expect(screen.getByText('Recent Batches')).toBeTruthy()
  })
})
