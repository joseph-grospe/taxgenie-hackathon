import { Link, createFileRoute } from '@tanstack/react-router'
import { IconArrowLeft, IconFileDescription } from '@tabler/icons-react'

import { AppShell } from '@/components/app-shell'
import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  batchDocumentDetails,
  batchDocuments,
  documentDetailsByFileName,
  issueQueue,
  validatedDocuments,
} from '@/data/mock-data'
import { cn } from '@/lib/utils'

type TrailStep = {
  label: string
  status: 'complete' | 'active' | 'pending' | 'error'
  detail?: string
}

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

function getTrailAndNextStep({
  status,
  stage,
}: {
  status?: string
  stage?: string
}): { trail: Array<TrailStep>; nextStep: string } {
  const base: Array<TrailStep> = [
    { label: 'Uploaded', status: 'complete' },
    { label: 'Queued', status: 'pending' },
    { label: 'OCR / Layout', status: 'pending' },
    { label: 'AI Normalize', status: 'pending' },
    { label: 'Validation + Variance', status: 'pending' },
    { label: 'Deduplication', status: 'pending' },
    { label: 'Rename + Persist', status: 'pending' },
    { label: 'Reconciliation', status: 'pending' },
  ]

  const markUpTo = (label: string) => {
    let found = false
    return base.map((step) => {
      if (found) return step
      if (step.label === label) {
        found = true
        return { ...step, status: 'active' as const, detail: stage }
      }
      return { ...step, status: 'complete' as const }
    })
  }

  if (!status) {
    return { trail: base, nextStep: 'Awaiting status update' }
  }

  if (status === 'Error') {
    const trail = markUpTo('Validation + Variance').map((step) =>
      step.label === 'Validation + Variance'
        ? {
            ...step,
            status: 'error' as const,
            detail: stage ?? 'Validation failed',
          }
        : step,
    )
    return { trail, nextStep: 'Review in Issues Queue' }
  }

  if (status === 'Duplicate') {
    const trail = markUpTo('Deduplication').map((step) =>
      step.label === 'Deduplication'
        ? { ...step, status: 'error' as const, detail: 'Flagged as duplicate' }
        : step,
    )
    return { trail, nextStep: 'Review in Issues Queue' }
  }

  if (status === 'OCR') {
    return { trail: markUpTo('OCR / Layout'), nextStep: 'AI Normalize' }
  }

  if (status === 'Validation') {
    return {
      trail: markUpTo('Validation + Variance'),
      nextStep: 'Deduplication',
    }
  }

  if (status === 'Done' || status === 'Validated' || status === 'Reconciled') {
    const trail = base.map((step) => {
      if (step.label === 'Reconciliation') {
        return {
          ...step,
          status:
            status === 'Reconciled'
              ? ('complete' as const)
              : ('pending' as const),
        }
      }
      return { ...step, status: 'complete' as const }
    })
    return { trail, nextStep: 'Reconciliation / reporting' }
  }

  return { trail: base, nextStep: 'Awaiting status update' }
}

export const Route = createFileRoute('/documents/$docId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { docId } = Route.useParams()

  // `docId` may be either a document id (DOC-####) or a filename (from issues).
  const docById = batchDocuments.find((d) => d.id === docId)
  const issueByFileName = issueQueue.find((i) => i.fileName === docId)
  const validatedById = validatedDocuments.find((d) => d.id === docId)
  const validatedByFileName = validatedDocuments.find(
    (d) => d.fileName === docId,
  )
  const validatedDoc = validatedById ?? validatedByFileName

  const fileName =
    docById?.fileName ??
    issueByFileName?.fileName ??
    validatedDoc?.fileName ??
    docId

  const statusRaw =
    docById?.status ?? issueByFileName?.type ?? validatedDoc?.status
  const status = statusRaw === 'Ready' ? 'Validated' : statusRaw

  const stage =
    docById?.stage ??
    (issueByFileName
      ? 'Needs review'
      : validatedDoc
        ? 'Ready to export'
        : undefined)

  const details =
    (docById?.id ? batchDocumentDetails[docById.id] : undefined) ??
    documentDetailsByFileName[fileName]

  const { trail, nextStep } = getTrailAndNextStep({ status, stage })
  const backTo = issueByFileName
    ? '/issues'
    : validatedDoc
      ? '/validated'
      : '/batch-status'

  const confidence = docById?.confidence ?? validatedDoc?.confidence
  const atc = docById?.atc ?? validatedDoc?.atc
  const payee = docById?.payee ?? validatedDoc?.payee
  const taxBase = docById?.taxBase ?? validatedDoc?.taxBase
  const taxWithheld = docById?.taxWithheld ?? validatedDoc?.taxWithheld

  return (
    <AppShell
      title="Document Detail"
      subtitle={docById?.id ?? issueByFileName?.id ?? validatedDoc?.id ?? docId}
      actions={
        <Button size="sm" variant="outline" asChild>
          <Link to={backTo} className="flex items-center gap-2">
            <IconArrowLeft className="size-4" />
            Back
          </Link>
        </Button>
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
              <CardTitle className="mt-2 text-2xl">{fileName}</CardTitle>
              <CardDescription>
                End-to-end processing view with trail, metadata, and audit logs.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {status ? <StatusPill status={status} /> : null}
              <Badge variant="outline">{nextStep}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4">
            <Card className="border-border/60 bg-muted/40">
              <CardHeader>
                <CardTitle className="text-base">Metadata</CardTitle>
                <CardDescription>
                  High-signal fields for triage.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Document ID:</span>{' '}
                  {docById?.id ?? validatedDoc?.id ?? '—'}
                </p>
                <p>
                  <span className="text-muted-foreground">Stage:</span>{' '}
                  {stage ?? '—'}
                </p>
                <p>
                  <span className="text-muted-foreground">Confidence:</span>{' '}
                  {confidence ?? '—'}
                </p>
                <p>
                  <span className="text-muted-foreground">ATC:</span>{' '}
                  {atc ?? '—'}
                </p>
                <p>
                  <span className="text-muted-foreground">Payee:</span>{' '}
                  {payee ?? '—'}
                </p>
                <p>
                  <span className="text-muted-foreground">Tax base:</span>{' '}
                  {taxBase ?? '—'}
                </p>
                <p>
                  <span className="text-muted-foreground">Tax withheld:</span>{' '}
                  {taxWithheld ?? '—'}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-muted/40">
              <CardHeader>
                <CardTitle className="text-base">Processing trail</CardTitle>
                <CardDescription>
                  What happened and what comes next.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {trail.map((step) => (
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
                  Worker timings and latest update.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Started:</span>{' '}
                  {details?.startedAt ?? '—'}
                </p>
                <p>
                  <span className="text-muted-foreground">Last update:</span>{' '}
                  {details?.updatedAt ?? '—'}
                </p>
                <p>
                  <span className="text-muted-foreground">Worker:</span>{' '}
                  {details?.worker ?? '—'}
                </p>
                <p>
                  <span className="text-muted-foreground">Elapsed:</span>{' '}
                  {details?.elapsed ?? '—'}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-muted/40">
              <CardHeader>
                <CardTitle className="text-base">Errors</CardTitle>
                <CardDescription>Reasons and rule failures.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {details?.errors.length ? (
                  details.errors.map((error) => (
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
                  Audit trail for this document.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {details?.logs.length ? (
                  <div className="rounded-2xl border border-border/60 bg-background/40">
                    {details.logs.map((log, index) => (
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

            <Separator />

            <Card className="border-border/60 bg-muted/40">
              <CardHeader>
                <CardTitle className="text-base">
                  Artifacts (Placeholder)
                </CardTitle>
                <CardDescription>
                  Links to raw PDF, processed PDF, and extracted JSON.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled>
                  Raw PDF
                </Button>
                <Button size="sm" variant="outline" disabled>
                  Processed PDF
                </Button>
                <Button size="sm" variant="outline" disabled>
                  Extraction JSON
                </Button>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
