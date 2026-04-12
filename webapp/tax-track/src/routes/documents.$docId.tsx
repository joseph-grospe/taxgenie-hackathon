import { Link, createFileRoute } from '@tanstack/react-router'
import { IconArrowLeft, IconFileDescription } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { AppShell } from '@/components/app-shell'
import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { OperationalDocumentView } from '@/lib/documents-types'
import { cn } from '@/lib/utils'

type TrailStep = OperationalDocumentView['trail'][number]

const trailStyles: Record<
  TrailStep['status'],
  { container: string; badge: string }
> = {
  complete: {
    container: 'border-emerald-500/25 bg-emerald-500/10',
    badge: 'border-emerald-500/30 text-emerald-700',
  },
  active: {
    container: 'border-cyan-500/25 bg-cyan-500/10',
    badge: 'border-cyan-500/30 text-cyan-700',
  },
  pending: {
    container: 'border-border/60 bg-muted/40',
    badge: 'border-border/60 text-muted-foreground',
  },
  error: {
    container: 'border-rose-500/25 bg-rose-500/10',
    badge: 'border-rose-500/30 text-rose-700',
  },
}

type DocumentResponse = {
  document?: OperationalDocumentView
  error?: string
}

export const Route = createFileRoute('/documents/$docId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { docId } = Route.useParams()
  const [document, setDocument] = useState<OperationalDocumentView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshDocument = useCallback(async () => {
    setIsLoading(true)

    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(docId)}`, {
        cache: 'no-store',
      })

      const payload = (await response.json().catch(() => null)) as
        | DocumentResponse
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to load document detail (${response.status}).`,
        )
      }

      setDocument(payload?.document ?? null)
      setLoadError(null)
    } catch (error) {
      setDocument(null)
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load document detail.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [docId])

  useEffect(() => {
    void refreshDocument()
  }, [refreshDocument])

  const backTo = useMemo(() => {
    if (!document) {
      return '/upload'
    }

    if (document.status === 'Ready') {
      return '/validated'
    }

    if (document.status === 'Duplicate' || document.status === 'Error') {
      return '/issues'
    }

    return '/upload'
  }, [document])

  return (
    <AppShell
      title="Document Detail"
      subtitle={document?.id ?? docId}
      actions={
        <Link
          to={backTo}
          className={cn(
            buttonVariants({ size: 'sm', variant: 'outline' }),
            'flex items-center gap-2',
          )}
        >
          <IconArrowLeft className="size-4" />
          Back
        </Link>
      }
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-muted-foreground">
                <IconFileDescription className="size-4" />
                Document
              </div>
              <CardTitle className="mt-2 text-2xl">
                {document?.fileName ?? docId}
              </CardTitle>
              <CardDescription>
                Upload intake, worker trail, validation output, and audit logs for this file.
              </CardDescription>
            </div>
            {document ? (
              <div className="flex items-center gap-2">
                <StatusPill status={document.status} />
                <Badge variant="outline">{document.nextStep}</Badge>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="rounded-2xl border border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              Loading document detail…
            </div>
          ) : loadError ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-6 text-sm text-rose-700">
              {loadError}
            </div>
          ) : !document ? (
            <div className="rounded-2xl border border-border/60 bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
              Document not found.
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                <Card className="border-border/60 bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-base">Metadata</CardTitle>
                    <CardDescription>
                      High-signal fields for review and export.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm">
                    <p>
                      <span className="text-muted-foreground">Document ID:</span>{' '}
                      {document.id}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Batch:</span>{' '}
                      {document.batchId}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Stage:</span>{' '}
                      {document.stage}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Owner:</span>{' '}
                      {document.owner}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Updated:</span>{' '}
                      {document.updatedAt}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Period:</span>{' '}
                      {document.period}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Payee:</span>{' '}
                      {document.payee}
                    </p>
                    <p>
                      <span className="text-muted-foreground">ATC:</span>{' '}
                      {document.atc}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Tax base:</span>{' '}
                      {document.taxBase}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Tax withheld:</span>{' '}
                      {document.taxWithheld}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Confidence:</span>{' '}
                      {document.confidence}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-base">Processing trail</CardTitle>
                    <CardDescription>
                      Pipeline steps derived from queue, worker, and result state.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    {document.trail.map((step) => (
                      <div
                        key={step.label}
                        className={cn(
                          'flex flex-wrap items-start justify-between gap-2 rounded-2xl border p-3',
                          trailStyles[step.status].container,
                        )}
                      >
                        <div>
                          <p className="text-sm font-medium">{step.label}</p>
                          {step.detail ? (
                            <p className="text-xs text-muted-foreground">
                              {step.detail}
                            </p>
                          ) : null}
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs uppercase',
                            trailStyles[step.status].badge,
                          )}
                        >
                          {step.status}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-4">
                <Card className="border-border/60 bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-base">Processing status</CardTitle>
                    <CardDescription>
                      Worker timings and current execution context.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm">
                    <p>
                      <span className="text-muted-foreground">Started:</span>{' '}
                      {document.processing?.startedAt ?? '—'}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Last update:</span>{' '}
                      {document.processing?.updatedAt ?? '—'}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Worker:</span>{' '}
                      {document.processing?.worker ?? '—'}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Elapsed:</span>{' '}
                      {document.processing?.elapsed ?? '—'}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-base">Errors</CardTitle>
                    <CardDescription>
                      Validation failures or duplicate reasons for this document.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {document.errors.length > 0 ? (
                      document.errors.map((error) => (
                        <div
                          key={`${error.code}-${error.stage}`}
                          className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3"
                        >
                          <p className="text-xs text-rose-700">
                            {error.code} · {error.stage}
                          </p>
                          <p className="mt-1">{error.message}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground">No errors flagged.</p>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-base">Event logs</CardTitle>
                    <CardDescription>
                      Chronological audit trail from upload through worker processing.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {document.logs.length > 0 ? (
                      <div className="rounded-2xl border border-border/60 bg-background/40">
                        {document.logs.map((log, index) => (
                          <div
                            key={`${log.timestamp}-${index}`}
                            className="flex flex-wrap items-start gap-3 border-b border-border/40 p-3 text-sm last:border-b-0"
                          >
                            <span className="text-xs text-muted-foreground">
                              {log.timestamp}
                            </span>
                            <Badge
                              variant="outline"
                              className="h-5 px-2 text-[10px] uppercase"
                            >
                              {log.level}
                            </Badge>
                            <p className="flex-1">{log.message}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No logs captured yet.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  )
}
