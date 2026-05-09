/* @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SUPPORT_EMAIL } from '@/components/support-sheet'
import { SiteHeader } from '@/components/site-header'

vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: ({ className }: { className?: string }) => (
    <button type="button" aria-label="Toggle sidebar" className={className} />
  ),
}))

afterEach(() => {
  cleanup()
})

describe('SiteHeader support action', () => {
  it('opens the support sheet and exposes the mail action', async () => {
    render(<SiteHeader title="Dashboard" />)

    const supportButton = screen.getByRole('button', { name: 'Support' })
    expect(supportButton).toBeTruthy()

    fireEvent.click(supportButton)

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
