/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import type { OperationalDocumentView } from '@/lib/documents-types'

vi.mock('@tanstack/react-router', () => {
  const Link = React.forwardRef<
    HTMLAnchorElement,
    React.AnchorHTMLAttributes<HTMLAnchorElement> & {
      to: string
      params?: Record<string, string>
    }
  >(({ to, params, children, ...props }, ref) => {
    let href = to
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value)
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
    createFileRoute:
      () =>
      (
        options: unknown,
      ): {
        options: unknown
        fullPath: string
        useSearch: () => Record<string, never>
      } => ({
        options,
        fullPath: '/issues',
        useSearch: () => ({}),
      }),
    useNavigate: () => vi.fn(),
    lazyRouteComponent: () => () => null,
  }
})

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: null }),
  },
}))

vi.mock('@/components/product-tour', () => ({
  IssuesTour: () => null,
}))

const { IssueRowActions } = await import('@/routes/issues')

const issue = {
  id: 'upload-1',
  uploadId: 'upload-1',
  fileName: 'bir-2307.pdf',
  canDownloadOriginalFile: true,
  extractionRetry: {
    provider: 'gemini',
    sourceDocumentResultId: 38,
    sourceExtractionAttemptId: 104,
    reasonCodes: ['gemini_http_503'],
    canRetry: true,
    retryCount: 0,
    maxRetries: 3,
    cooldownUntil: null,
    disabledReason: null,
  },
} as OperationalDocumentView

describe('Issues retry actions', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders and submits the desktop retry action', () => {
    const onRetry = vi.fn()
    render(
      <IssueRowActions
        issue={issue}
        isDownloading={false}
        isRetrying={false}
        onDownload={vi.fn()}
        onRetry={onRetry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry extraction' }))
    expect(onRetry).toHaveBeenCalledWith(issue)
  })

  it('shows the retry action in the mobile row menu', async () => {
    render(
      <IssueRowActions
        issue={issue}
        isDownloading={false}
        isRetrying={false}
        onDownload={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for bir-2307.pdf' }),
    )
    expect(await screen.findByText('Retry extraction')).toBeTruthy()
  })

  it('disables retry with the server-provided processing reason', () => {
    render(
      <IssueRowActions
        issue={{
          ...issue,
          extractionRetry: {
            ...issue.extractionRetry!,
            canRetry: false,
            disabledReason: 'already_processing',
          },
        }}
        isDownloading={false}
        isRetrying={false}
        onDownload={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    const retryButton = screen.getByRole('button', {
      name: 'Extraction queued',
    })
    expect(retryButton.hasAttribute('disabled')).toBe(true)
  })

  it('shows the queueing state while a retry request is submitting', () => {
    render(
      <IssueRowActions
        issue={issue}
        isDownloading={false}
        isRetrying
        onDownload={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    const retryButton = screen.getByRole('button', {
      name: 'Queueing retry',
    })
    expect(retryButton.hasAttribute('disabled')).toBe(true)
  })
})
