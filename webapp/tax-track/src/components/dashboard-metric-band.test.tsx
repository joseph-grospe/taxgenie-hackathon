/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ReactNode } from 'react'

import type { DashboardMetricGroup } from '@/lib/dashboard-types'
import { DashboardMetricBand } from '@/components/dashboard-metric-band'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children, ...props }: ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}))

const groups: Array<DashboardMetricGroup> = [
  {
    id: 'volume',
    label: 'Volume',
    metrics: [
      {
        id: 'totalUploaded',
        label: 'Uploaded from API',
        value: '1,234',
        detail: '1,234 source certificates',
        description: 'Uploaded metric description.',
      },
      {
        id: 'totalProcessed',
        label: 'Processed from API',
        value: '1,111',
        detail: '90.03% terminal',
        description: 'Processed metric description.',
      },
    ],
  },
  {
    id: 'collection',
    label: 'Collection',
    metrics: [
      {
        id: 'totalCollected',
        label: 'Collected from API',
        value: '777',
        detail: '700 matched · 77 pending',
        description: 'Collected metric description.',
      },
      {
        id: 'totalUncollected',
        label: 'Uncollected from API',
        value: '334',
        detail: '₱45,678.90 outstanding',
        description: 'Uncollected metric description.',
      },
    ],
  },
  {
    id: 'quality',
    label: 'Quality from API',
    metrics: [
      {
        id: 'good2307',
        label: 'Good from API',
        value: '80.1%',
        detail: '890 without errors',
        description: 'Good metric description.',
      },
      {
        id: 'review2307',
        label: 'Review from API',
        value: '9.8%',
        detail: '109 awaiting review',
        description: 'Review metric description.',
      },
      {
        id: 'bad2307',
        label: 'Bad from API',
        value: '10.1%',
        detail: '112 with issues',
        description: 'Bad metric description.',
      },
    ],
  },
  {
    id: 'timing',
    label: 'Timing from API',
    metrics: [
      {
        id: 'averageTat',
        label: 'Batch TAT from API',
        value: '4h 12m',
        detail: 'Average to first download',
        description: 'TAT metric description.',
      },
      {
        id: 'daysUncollected',
        label: 'Days uncollected from API',
        value: '13.7',
        detail: 'Average outstanding age',
        description: 'Age metric description.',
      },
    ],
  },
]

afterEach(cleanup)

describe('DashboardMetricBand', () => {
  it('renders all nine API metrics verbatim in the redesigned grouping', () => {
    render(<DashboardMetricBand groups={groups} />)

    for (const metric of groups.flatMap((group) => group.metrics)) {
      expect(screen.getByText(metric.label)).toBeTruthy()
      expect(screen.getByText(metric.value)).toBeTruthy()
      expect(screen.getByText(metric.detail)).toBeTruthy()
      expect(screen.getByText(metric.description)).toBeTruthy()
    }

    const qualityCard = screen
      .getByText('Quality from API')
      .closest('[data-slot="card"]')
    const timingCard = screen
      .getByText('Timing from API')
      .closest('[data-slot="card"]')

    expect(qualityCard).toBeTruthy()
    expect(timingCard).toBeTruthy()
    expect(within(qualityCard!).getByText('Good from API')).toBeTruthy()
    expect(within(qualityCard!).getByText('Review from API')).toBeTruthy()
    expect(within(qualityCard!).getByText('Bad from API')).toBeTruthy()
    expect(within(timingCard!).getByText('Batch TAT from API')).toBeTruthy()
    expect(
      within(timingCard!).getByText('Days uncollected from API'),
    ).toBeTruthy()

    expect(
      within(qualityCard!).getByText('80.1%').classList.contains('text-xl'),
    ).toBe(true)
    const timingValue = within(timingCard!).getByText('4h 12m')
    expect(timingValue.classList.contains('text-xl')).toBe(true)
    expect(timingValue.classList.contains('line-clamp-2')).toBe(true)
    expect(
      screen.getByText('Uploaded from API').classList.contains('text-xs'),
    ).toBe(true)
    expect(screen.getByText('1,234').classList.contains('text-xl')).toBe(true)
    expect(
      screen
        .getByText('1,234 source certificates')
        .classList.contains('text-xs'),
    ).toBe(true)
    expect(
      screen.getByText('Quality from API').classList.contains('text-sm'),
    ).toBe(true)
  })

  it('renders four primary and five grouped loading metric placeholders', () => {
    const { container } = render(<DashboardMetricBand groups={[]} loading />)

    expect(screen.getByText('Quality')).toBeTruthy()
    expect(screen.getByText('Timing')).toBeTruthy()
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      31,
    )
  })
})
