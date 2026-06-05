/* @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PageHelpMenu } from '@/components/page-help-menu'
import { SUPPORT_EMAIL } from '@/components/support-sheet'

afterEach(() => {
  cleanup()
})

describe('PageHelpMenu', () => {
  it('starts the current page tour from the help menu', async () => {
    const onStartTour = vi.fn()

    render(<PageHelpMenu tourAction={{ onStartTour }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(
      await screen.findByText('Guide me through this page'),
    )

    expect(onStartTour).toHaveBeenCalledOnce()
  })

  it('opens support from the help menu', async () => {
    render(<PageHelpMenu />)

    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(await screen.findByText('Contact support'))

    expect(await screen.findByText('What to include')).toBeTruthy()
    expect(screen.getByText(SUPPORT_EMAIL)).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])

    await waitFor(() => {
      expect(screen.queryByText('What to include')).toBeNull()
    })
  })
})
