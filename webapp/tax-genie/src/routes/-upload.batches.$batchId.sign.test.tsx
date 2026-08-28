/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { ReactNode } from 'react'

import { BatchSigningRouteContent } from '@/routes/upload.batches.$batchId.sign'

const authMocks = vi.hoisted(() => ({
  useSession: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/lib/download-client', () => ({
  downloadResponseAttachment: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => {
  const Link = React.forwardRef<
    HTMLAnchorElement,
    {
      to: string
      params?: Record<string, string>
      search?: Record<string, string | number>
      children?: ReactNode
      className?: string
      replace?: boolean
      [key: string]: unknown
    }
  >(({ to, params, search, children, replace: _replace, ...props }, ref) => {
    let href = to

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        href = href.replace(`$${key}`, value)
      }
    }

    if (search) {
      const query = new URLSearchParams(
        Object.fromEntries(
          Object.entries(search).map(([key, value]) => [key, String(value)]),
        ),
      ).toString()
      href = query ? `${href}?${query}` : href
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
    createFileRoute: () => (config: { component: React.ComponentType }) => ({
      ...config,
      useParams: () => ({ batchId: 'batch-1' }),
    }),
    lazyRouteComponent: () => () => null,
  }
})

vi.mock('@/components/app-shell', () => ({
  AppShell: ({
    children,
    leadingActions,
    pageHelp,
    title,
    tourTargets,
  }: {
    children: ReactNode
    leadingActions?: ReactNode
    pageHelp?: { label: string; onStartTour: () => void }
    title: string
    tourTargets?: { leadingActions?: string; title?: string }
  }) => (
    <main>
      <h1 data-tour-id={tourTargets?.title}>{title}</h1>
      <div data-tour-id={tourTargets?.leadingActions}>{leadingActions}</div>
      {pageHelp ? (
        <button type="button" onClick={pageHelp.onStartTour}>
          {pageHelp.label}
        </button>
      ) : null}
      {children}
    </main>
  ),
}))

vi.mock('@/components/document-signing-page', () => ({
  DocumentSigningPage: ({
    batchId,
    canDownloadSignedPdf,
    tourTargets,
  }: {
    batchId: string
    canDownloadSignedPdf?: boolean
    tourTargets?: { certificateList?: string }
  }) => (
    <div data-tour-id={tourTargets?.certificateList}>
      Signing page {batchId}{' '}
      {canDownloadSignedPdf ? 'download allowed' : 'download denied'}
    </div>
  ),
}))

vi.mock('@/components/ui/alert', () => {
  const Div = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  )

  return {
    Alert: Div,
    AlertDescription: Div,
    AlertTitle: Div,
  }
})

vi.mock('@/components/ui/button', () => ({
  buttonVariants: () => '',
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: authMocks.useSession,
  },
}))

const taxManagerUser = {
  id: 'user-1',
  email: 'manager@example.com',
  role: 'editor',
  team: 'tax_manager',
  canExportPdf: true,
  canExportExcel: false,
  mustChangePassword: false,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('/upload/batches/$batchId/sign route', () => {
  it('renders the signing workspace for Tax Manager Team users', () => {
    authMocks.useSession.mockReturnValue({
      data: { user: taxManagerUser },
      isPending: false,
    })

    render(<BatchSigningRouteContent batchId="batch-1" />)

    expect(
      screen.getByText(/signing page batch-1 download allowed/i),
    ).toBeTruthy()
    expect(screen.getByText('Guide me through signing')).toBeTruthy()
    expect(screen.getByText('Sign batch').dataset.tourId).toBe('signing.title')
    expect(
      screen.getByRole('link', { name: /back/i }).parentElement?.dataset.tourId,
    ).toBe('signing.backAction')
    expect(screen.getByText(/signing page batch-1/i).dataset.tourId).toBe(
      'signing.certificateList',
    )

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    fireEvent.click(screen.getByText('Guide me through signing'))

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'taxgenie.signingTour.restart',
      }),
    )
    expect(screen.queryByText('Signing is restricted.')).toBeNull()
  })

  it('shows an unauthorized state for users outside Tax Manager Team', () => {
    authMocks.useSession.mockReturnValue({
      data: {
        user: {
          ...taxManagerUser,
          team: 'tax_team',
        },
      },
      isPending: false,
    })

    render(<BatchSigningRouteContent batchId="batch-1" />)

    expect(screen.getByText('Signing is restricted.')).toBeTruthy()
    expect(
      screen.getByText('Only Tax Manager Team users can sign certificates.'),
    ).toBeTruthy()
    expect(screen.queryByText('Guide me through signing')).toBeNull()
    expect(screen.queryByText(/signing page batch-1/i)).toBeNull()
  })
})
