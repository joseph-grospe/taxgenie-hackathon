/* @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

import { SUPPORT_EMAIL } from '@/components/support-sheet'
import { SiteHeader } from '@/components/site-header'

vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: ({ className, ...props }: ComponentProps<'button'>) => (
    <button
      type="button"
      aria-label="Toggle sidebar"
      className={className}
      {...props}
    />
  ),
}))

afterEach(() => {
  cleanup()
})

describe('SiteHeader support action', () => {
  it('exposes dashboard tour targets and a custom guide action', async () => {
    const onStartTour = vi.fn()

    render(
      <SiteHeader
        title="Dashboard"
        leadingActions={<button type="button">Back</button>}
        entityScope={<button type="button">All entities</button>}
        actions={<button type="button">Refresh dashboard</button>}
        pageHelp={{
          label: 'Guide me through the dashboard',
          onStartTour,
        }}
        tourTargets={{
          actions: 'dashboard.actions',
          entityScope: 'dashboard.entityScope',
          help: 'dashboard.help',
          leadingActions: 'dashboard.backAction',
          sidebarTrigger: 'dashboard.sidebarTrigger',
          title: 'dashboard.title',
        }}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Toggle sidebar' }).dataset.tourId,
    ).toBe('dashboard.sidebarTrigger')
    expect(
      screen.getByText('Dashboard').closest('[data-tour-id]')?.dataset.tourId,
    ).toBe('dashboard.title')
    expect(
      screen.getByRole('button', { name: 'Back' }).parentElement?.dataset
        .tourId,
    ).toBe('dashboard.backAction')
    expect(
      screen.getByRole('button', { name: 'All entities' }).parentElement
        ?.dataset.tourId,
    ).toBe('dashboard.entityScope')
    expect(
      screen.getByRole('button', { name: 'Refresh dashboard' }).parentElement
        ?.dataset.tourId,
    ).toBe('dashboard.actions')

    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(await screen.findByText('Guide me through the dashboard'))

    expect(onStartTour).toHaveBeenCalledOnce()
  })

  it('opens support from the help menu and exposes the mail action', async () => {
    render(<SiteHeader title="Dashboard" />)

    const helpButton = screen.getByRole('button', { name: 'Help' })
    expect(helpButton).toBeTruthy()

    fireEvent.click(helpButton)
    fireEvent.click(await screen.findByText('Contact support'))

    expect(screen.getByText('What to include')).toBeTruthy()
    expect(screen.getByText(SUPPORT_EMAIL)).toBeTruthy()

    const emailAction = screen.getByRole('link', { name: /email support/i })
    expect(emailAction.getAttribute('href')).toContain(
      `mailto:${SUPPORT_EMAIL}`,
    )
    expect(emailAction.getAttribute('href')).toContain(
      'subject=TaxTrack%20support%20request',
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])

    await waitFor(() => {
      expect(screen.queryByText('What to include')).toBeNull()
    })
  })
})
