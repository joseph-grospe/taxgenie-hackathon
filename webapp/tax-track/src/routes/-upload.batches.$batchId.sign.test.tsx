/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { ReactNode } from 'react'

const authMocks = vi.hoisted(() => ({
  useSession: vi.fn(),
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
    title,
  }: {
    children: ReactNode
    leadingActions?: ReactNode
    title: string
  }) => (
    <main>
      <h1>{title}</h1>
      {leadingActions}
      {children}
    </main>
  ),
}))

vi.mock('@/components/document-signing-page', () => ({
  DocumentSigningPage: ({
    batchId,
    canDownloadSignedPdf,
  }: {
    batchId: string
    canDownloadSignedPdf?: boolean
  }) => (
    <div>
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

const { BatchSigningRouteContent } =
  await import('@/routes/upload.batches.$batchId.sign')

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
    expect(screen.queryByText(/signing page batch-1/i)).toBeNull()
  })
})
