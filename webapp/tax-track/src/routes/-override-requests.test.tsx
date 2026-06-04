/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => {
  const Link = React.forwardRef<
    HTMLAnchorElement,
    {
      to: string
      params?: Record<string, string>
      children?: ReactNode
      className?: string
      [key: string]: unknown
    }
  >(({ to, params, children, ...props }, ref) => {
    let href = to
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, value)
      }
    }

    return (
      <a ref={ref} href={href} {...props}>
        {children}
      </a>
    )
  })

  Link.displayName = 'MockTanStackLink'

  return {
    Link,
    createFileRoute: () => (config: unknown) => config,
  }
})

vi.mock('@/components/app-shell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const { OverrideRequestDecisionPanel, overrideDecisionSheetLayoutClasses } =
  await import('@/routes/override-requests')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OverrideRequestDecisionPanel', () => {
  it('renders pending request details and exposes approve/reject actions', () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    const onDecisionNoteChange = vi.fn()

    render(
      <OverrideRequestDecisionPanel
        request={{
          id: 'override-1',
          documentResultId: 9001,
          uploadId: 'upload-1',
          batchId: 'batch-1',
          status: 'pending',
          fileName: 'BIR2307_TEST.pdf',
          entity: 'Test Entity',
          payee: 'Payee Inc.',
          payorName: 'Payor Inc.',
          payorTin: '123456789',
          issueReason: 'Payor not found in masterlist.',
          requestNote: 'Business-approved exception.',
          requestedAt: 'May 20, 2026, 09:00 AM',
          requestedByName: 'Editor User',
          requestedByEmail: 'editor@example.com',
          decidedAt: null,
          decidedByName: null,
          decisionNote: null,
        }}
        decisionNote="Approved after review."
        onDecisionNoteChange={onDecisionNoteChange}
        decisionAction={null}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )

    expect(screen.getByText('BIR2307_TEST.pdf')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /open document/i }).getAttribute('href'),
    ).toBe('/documents/9001')
    fireEvent.change(screen.getByLabelText(/decision note/i), {
      target: { value: 'Updated note.' },
    })
    expect(onDecisionNoteChange).toHaveBeenCalledWith('Updated note.')

    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(onApprove).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /reject/i }))
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(
      screen
        .getByRole('button', { name: /approve/i })
        .closest('[data-slot="sheet-footer"]'),
    ).toBeTruthy()
  })

  it('keeps the decision body scrollable and the footer outside the scroll area', () => {
    expect(overrideDecisionSheetLayoutClasses.panel).toContain('min-h-0')
    expect(overrideDecisionSheetLayoutClasses.panel).toContain('flex-1')
    expect(overrideDecisionSheetLayoutClasses.body).toContain('min-h-0')
    expect(overrideDecisionSheetLayoutClasses.body).toContain('flex-1')
    expect(overrideDecisionSheetLayoutClasses.body).toContain('overflow-y-auto')
    expect(overrideDecisionSheetLayoutClasses.footer).toContain('shrink-0')
    expect(overrideDecisionSheetLayoutClasses.footer).toContain('border-t')
  })
})
