/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import type { DashboardCollectionSummary } from '@/lib/dashboard-types'
import {
  DASHBOARD_COLLECTION_CARD_TITLE,
  DashboardCollectionStatusBadges,
} from '@/components/dashboard-collection-summary'

vi.mock('recharts', () => ({
  Cell: () => null,
  Legend: () => null,
  Pie: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PieChart: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: () => null,
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

afterEach(() => {
  cleanup()
})

describe('DashboardCollectionSummaryCard', () => {
  it('distinguishes collected certificates from reconciliation row states', () => {
    render(<DashboardCollectionStatusBadges summary={summary} />)

    expect(DASHBOARD_COLLECTION_CARD_TITLE).toBe(
      'Collection and reconciliation',
    )
    expect(screen.getByText('5 matched')).toBeTruthy()
    expect(screen.getByText('2 pending variance')).toBeTruthy()
  })

  it('renders explicit zero-state reconciliation counts', () => {
    render(<DashboardCollectionStatusBadges />)

    expect(screen.getByText('0 matched')).toBeTruthy()
    expect(screen.getByText('0 pending variance')).toBeTruthy()
  })
})
