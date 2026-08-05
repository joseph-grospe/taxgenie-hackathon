import { Link, createFileRoute } from '@tanstack/react-router'
import {
  IconArrowLeft,
  IconFileDescription,
  IconListCheck,
  IconShieldExclamation,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { OperationalDocumentView } from '@/lib/documents-types'
import { AppShell } from '@/components/app-shell'
import { ExtractionRetryAction } from '@/components/extraction-retry-action'
import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  isExtractionRetryActive,
  queueGeminiExtractionRetry,
} from '@/lib/extraction-retry-client'
import { cn } from '@/lib/utils'

type DocumentResponse = {
  document?: OperationalDocumentView
  error?: string
}

type ErrorDetailSearch = {
  docId: string
  errorIndex?: string
}

export const Route = createFileRoute('/error-detail')({
  validateSearch: (search): ErrorDetailSearch => ({
    docId: typeof search.docId === 'string' ? search.docId : '',
    errorIndex: typeof search.errorIndex === 'string' ? search.errorIndex : '0',
  }),
  component: RouteComponent,
})

const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'
const PANEL_BORDER_CLASS = 'border-border/60'
const ACTIVE_RETRY_POLL_INTERVAL_MS = 8_000

export function RouteComponent() {
  const search = Route.useSearch()
  const [document, setDocument] = useState<OperationalDocumentView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRetryingExtraction, setIsRetryingExtraction] = useState(false)

  const refreshDocument = useCallback(async () => {
    if (!search.docId) {
      setDocument(null)
      setLoadError('Missing document id.')
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(search.docId)}`,
        {
          cache: 'no-store',
        },
      )

      const payload = (await response
        .json()
        .catch(() => null)) as DocumentResponse | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load document detail (${response.status}).`,
        )
      }

      setDocument(payload?.document ?? null)
      setLoadError(null)
    } catch (error) {
      setDocument(null)
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load error detail.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [search.docId])

  useEffect(() => {
    void refreshDocument()
  }, [refreshDocument])

  const shouldPollExtractionRetry = isExtractionRetryActive(
    document?.extractionRetry,
  )

  useEffect(() => {
    if (!shouldPollExtractionRetry) return

    const refreshIfVisible = () => {
      if (globalThis.document.visibilityState === 'visible') {
        void refreshDocument()
      }
    }
    const interval = window.setInterval(
      refreshIfVisible,
      ACTIVE_RETRY_POLL_INTERVAL_MS,
    )

    return () => window.clearInterval(interval)
  }, [refreshDocument, shouldPollExtractionRetry])

  const handleRetryExtraction = useCallback(async () => {
    if (!document || isRetryingExtraction) return

    setIsRetryingExtraction(true)
    try {
      const retry = await queueGeminiExtractionRetry(document)
      toast.success('Extraction retry queued', {
        description: `Retry ${retry.retryNumber} will reuse the original PDF.`,
      })
      await refreshDocument()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to queue the extraction retry.',
      )
    } finally {
      setIsRetryingExtraction(false)
    }
  }, [document, isRetryingExtraction, refreshDocument])

  const parsedErrorIndex = Number.parseInt(search.errorIndex ?? '0', 10)
  const selectedErrorIndex = Number.isFinite(parsedErrorIndex)
    ? Math.max(0, parsedErrorIndex)
    : 0

  const selectedError =
    document?.errors[selectedErrorIndex] ?? document?.errors[0]
  const failedChecks = useMemo(
    () => (document?.validationChecks ?? []).filter((check) => !check.passed),
    [document],
  )

  return (
    <AppShell
      title="Error Review"
      subtitle={
        document?.fileName ?? 'Inspect validation failures and extracted values'
      }
      leadingActions={
        <Link
          to="/documents/$docId"
          params={{ docId: search.docId }}
          search={{ from: 'error-detail' }}
          className={cn(
            buttonVariants({ size: 'sm', variant: 'outline' }),
            'flex items-center gap-2',
          )}
        >
          <IconArrowLeft data-icon="inline-start" />
          Back
        </Link>
      }
    >
      {isLoading ? (
        <div
          className={cn(
            'rounded-lg border bg-muted/20 px-4 py-5 text-sm text-muted-foreground',
            PANEL_BORDER_CLASS,
          )}
        >
          Loading error detail…
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-5 text-sm text-rose-700">
          {loadError}
        </div>
      ) : !document || !selectedError ? (
        <div
          className={cn(
            'rounded-lg border bg-muted/20 px-4 py-5 text-sm text-muted-foreground',
            PANEL_BORDER_CLASS,
          )}
        >
          No error detail available for this document.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="flex flex-col gap-3">
            <BlockingErrorCard
              document={document}
              error={selectedError}
              isRetryingExtraction={isRetryingExtraction}
              onRetryExtraction={() => void handleRetryExtraction()}
            />

            <Card size="sm" className={cn('rounded-lg', PANEL_CARD_CLASS)}>
              <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
                <CardTitle className="text-sm">Validation checks</CardTitle>
                <CardDescription className="text-xs">
                  Exact checks that passed or failed for this document.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {document.validationChecks.length > 0 ? (
                  document.validationChecks.map((check) => (
                    <div
                      key={`${check.code}-${check.message}`}
                      className={cn(
                        'rounded-lg border px-3 py-2.5',
                        check.passed
                          ? 'border-emerald-500/15 bg-emerald-500/5'
                          : 'border-rose-500/15 bg-rose-500/5',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p
                          className={cn(
                            'text-xs font-medium',
                            check.passed ? 'text-emerald-700' : 'text-rose-700',
                          )}
                        >
                          {check.code}
                        </p>
                        <Badge variant="outline">
                          {check.passed ? 'Passed' : 'Failed'}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-foreground">
                        {check.message}
                      </p>
                    </div>
                  ))
                ) : (
                  <ValidationChecksEmptyState
                    message={document.validationChecksEmptyMessage}
                  />
                )}
              </CardContent>
            </Card>

            {document.errors.length > 1 ? (
              <Card size="sm" className={cn('rounded-lg', PANEL_CARD_CLASS)}>
                <CardHeader
                  className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}
                >
                  <CardTitle className="text-sm">
                    Other detected errors
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Open another error from the same document.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {document.errors.map((error, index) => (
                    <Link
                      key={`${error.code}-${index}`}
                      to="/error-detail"
                      search={{
                        docId: search.docId,
                        errorIndex: String(index),
                      }}
                      className={cn(
                        'block rounded-lg border px-3 py-2.5 transition-colors',
                        index === selectedErrorIndex
                          ? 'border-rose-500/20 bg-rose-500/8'
                          : 'border-border/60 bg-background hover:bg-muted/35',
                      )}
                    >
                      <p className="text-xs font-medium text-muted-foreground">
                        {error.code} · {error.stage}
                      </p>
                      <p className="mt-1 text-xs leading-5">{error.message}</p>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            <Card size="sm" className={cn('rounded-lg', PANEL_CARD_CLASS)}>
              <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <IconListCheck className="size-4" />
                  Extracted fields for verification
                </CardTitle>
                <CardDescription className="text-xs">
                  Review the normalized values and their confidence before
                  retrying or correcting the document.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {document.reviewFields.length > 0 ? (
                  document.reviewFields.map((field) => (
                    <div
                      key={field.label}
                      className={cn(
                        'rounded-lg border bg-background px-3 py-2.5',
                        PANEL_BORDER_CLASS,
                      )}
                    >
                      <p className="text-xs font-medium text-muted-foreground">
                        {field.label}
                      </p>
                      <p className="mt-1 text-xs font-medium break-words">
                        {field.value}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Confidence {field.confidence}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No extracted field data available.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card size="sm" className={cn('rounded-lg', PANEL_CARD_CLASS)}>
              <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <IconFileDescription className="size-4" />
                  Review notes
                </CardTitle>
                <CardDescription className="text-xs">
                  Context from the worker timeline that may help explain the
                  failure.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {failedChecks.length > 0 ? (
                  failedChecks.map((check) => (
                    <div
                      key={`${check.code}-${check.message}`}
                      className={cn(
                        'rounded-lg border bg-background px-3 py-2.5',
                        PANEL_BORDER_CLASS,
                      )}
                    >
                      <p className="text-xs font-medium text-muted-foreground">
                        Failed check
                      </p>
                      <p className="mt-1 text-xs font-medium">{check.code}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {check.message}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No failed validation checks recorded.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  )
}

export function ValidationChecksEmptyState({ message }: { message?: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {message ?? 'No validation checks recorded.'}
    </p>
  )
}

export function BlockingErrorCard({
  document,
  error,
  isRetryingExtraction = false,
  onRetryExtraction,
}: {
  document: OperationalDocumentView
  error: OperationalDocumentView['errors'][number]
  isRetryingExtraction?: boolean
  onRetryExtraction?: () => void
}) {
  return (
    <Card
      size="sm"
      className="rounded-lg border border-rose-500/25 bg-rose-500/5"
    >
      <CardHeader className="gap-3 border-b border-rose-500/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-rose-700">
              <IconShieldExclamation className="size-4" />
              Blocking error
            </div>
            <CardTitle className="mt-2 text-base text-rose-950">
              {error.message}
            </CardTitle>
            <CardDescription className="text-xs text-rose-700">
              {error.code} · {error.stage}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={document.status} />
            <Badge variant="outline">{document.stage}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <SummaryCard label="Document" value={document.fileName} />
        <SummaryCard label="Issue reason" value={document.issueReason} />
        <SummaryCard label="Payee" value={document.payee} />
        <SummaryCard label="Period" value={document.period} />
        <SummaryCard label="ATC" value={document.atc} />
        <SummaryCard label="Owner" value={document.owner} />
      </CardContent>
      {document.extractionRetry ? (
        <CardFooter className="border-t border-rose-500/20">
          <ExtractionRetryAction
            retry={document.extractionRetry}
            isRetrying={isRetryingExtraction}
            onRetry={onRetryExtraction}
          />
        </CardFooter>
      ) : null}
    </Card>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-background px-3 py-2.5',
        PANEL_BORDER_CLASS,
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xs font-medium break-words">{value || '—'}</p>
    </div>
  )
}
