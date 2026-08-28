/* @vitest-environment jsdom */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Root } from 'react-dom/client'

import type { DashboardCollectionSummary } from '@/lib/dashboard-types'
import {
  DASHBOARD_COLLECTION_CARD_TITLE,
  DashboardCollectionStatusBadges,
  DashboardCollectionSummaryCard,
} from '@/components/dashboard-collection-summary'

vi.mock('recharts', () => ({
  Cell: () => null,
  Legend: () => null,
  Pie: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  PieChart: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: () => null,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

const summary: DashboardCollectionSummary = {
  collectedCount: 7,
  matchedResultCount: 5,
  pendingVarianceResultCount: 2,
  collectedAmount: 2_197_104.21,
  collectedAmountLabel: '₱2,197,104.21',
  uncollectedCount: 3,
  uncollectedAmount: 90_509_328.25,
  uncollectedAmountLabel: '₱90,509,328.25',
  totalAmount: 92_706_432.46,
  totalAmountLabel: '₱92,706,432.46',
  collectionRate: 2.37,
  collectionRateLabel: '2.4%',
}

const zeroSummary: DashboardCollectionSummary = {
  collectedCount: 0,
  matchedResultCount: 0,
  pendingVarianceResultCount: 0,
  collectedAmount: 0,
  collectedAmountLabel: '₱0.00',
  uncollectedCount: 0,
  uncollectedAmount: 0,
  uncollectedAmountLabel: '₱0.00',
  totalAmount: 0,
  totalAmountLabel: '₱0.00',
  collectionRate: 0,
  collectionRateLabel: '0%',
}

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = []

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const renderCollection = async (node: React.ReactNode) => {
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

describe('DashboardCollectionSummaryCard', () => {
  it('distinguishes collected certificates from reconciliation row states', async () => {
    await renderCollection(
      <DashboardCollectionStatusBadges summary={summary} />,
    )

    expect(DASHBOARD_COLLECTION_CARD_TITLE).toBe(
      'Collection and reconciliation',
    )
    expect(screen.getByText('5 matched')).toBeTruthy()
    expect(screen.getByText('2 pending variance')).toBeTruthy()
  })

  it('renders explicit zero-state reconciliation counts', async () => {
    await renderCollection(<DashboardCollectionStatusBadges />)

    expect(screen.getByText('0 matched')).toBeTruthy()
    expect(screen.getByText('0 pending variance')).toBeTruthy()
  })

  it('renders the nonzero amounts, certificate counts, badges, and rate verbatim', async () => {
    await renderCollection(<DashboardCollectionSummaryCard summary={summary} />)

    expect(screen.getByText(summary.totalAmountLabel)).toBeTruthy()
    expect(screen.getByText(summary.collectedAmountLabel)).toBeTruthy()
    expect(screen.getByText(summary.uncollectedAmountLabel)).toBeTruthy()
    expect(screen.getByText('7 certificates')).toBeTruthy()
    expect(screen.getByText('3 records')).toBeTruthy()
    expect(screen.getByText('5 matched')).toBeTruthy()
    expect(screen.getByText('2 pending variance')).toBeTruthy()
    expect(screen.getAllByText(summary.collectionRateLabel)).toHaveLength(2)
    expect(
      screen
        .getByText(DASHBOARD_COLLECTION_CARD_TITLE)
        .classList.contains('text-sm'),
    ).toBe(true)
    expect(
      screen
        .getByText(
          'Withholding collection plus certificate reconciliation status.',
        )
        .classList.contains('text-xs'),
    ).toBe(true)
    expect(
      screen.getByText('Total withholding').classList.contains('text-xs'),
    ).toBe(true)
    expect(
      screen.getByText('Selected period').classList.contains('text-xs'),
    ).toBe(true)

    const amountSections = document.querySelectorAll(
      '[data-slot="collection-summary-amount"]',
    )
    expect(amountSections).toHaveLength(3)
    for (const section of amountSections) {
      expect(section.classList.contains('border')).toBe(false)
      expect(section.classList.contains('rounded-lg')).toBe(false)
    }
    expect(
      screen.getByText(summary.totalAmountLabel).classList.contains('text-xl'),
    ).toBe(true)
  })

  it('renders explicit zero amounts, counts, badges, and rate', async () => {
    await renderCollection(
      <DashboardCollectionSummaryCard summary={zeroSummary} />,
    )

    expect(screen.getAllByText('₱0.00')).toHaveLength(3)
    expect(screen.getByText('0 certificates')).toBeTruthy()
    expect(screen.getByText('0 records')).toBeTruthy()
    expect(screen.getByText('0 matched')).toBeTruthy()
    expect(screen.getByText('0 pending variance')).toBeTruthy()
    expect(screen.getAllByText('0%')).toHaveLength(2)
  })

  it('renders the collection loading placeholders without stale values', async () => {
    const { container } = await renderCollection(
      <DashboardCollectionSummaryCard summary={summary} loading />,
    )

    expect(screen.queryByText(summary.totalAmountLabel)).toBeNull()
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      12,
    )
  })
})
