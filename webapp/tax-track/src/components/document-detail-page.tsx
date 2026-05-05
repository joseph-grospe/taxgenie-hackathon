import { Link } from '@tanstack/react-router'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClockHour4,
  IconDownload,
  IconFileAnalytics,
  IconFileDescription,
  IconListDetails,
  IconShieldExclamation,
  IconTimeline,
} from '@tabler/icons-react'
import type { CSSProperties, ReactNode } from 'react'

import type {
  DocumentLogLevel,
  DocumentTrailStatus,
  OperationalDocumentView,
} from '@/lib/documents-types'
import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

const LOG_PREVIEW_COUNT = 6
const PANEL_CARD_CLASS = 'border border-border/70 shadow-sm'
const PANEL_BORDER_CLASS = 'border-border/70'

type FieldTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

type DetailField = {
  label: string
  value: string
  tone?: FieldTone
  span?: 'full' | 'half'
  size?: 'default' | 'emphasis'
}

type SummaryItem = {
  label: string
  value: string
}

type DocumentDetailPageProps = {
  document: OperationalDocumentView | null
  isLoading: boolean
  loadError: string | null
  onResolveAttention?: () => void
  canDownloadSignedPdf?: boolean
}

type DocumentDetailViewModel = {
  fileName: string
  summaryMeta: Array<string>
  metadataItems: Array<DetailField>
  processingSummaryItems: Array<SummaryItem>
}

const fieldToneStyles: Record<FieldTone, string> = {
  neutral: 'text-foreground',
  accent: 'text-sky-700',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-rose-700',
}

const fieldSurfaceStyles: Record<FieldTone, string> = {
  neutral: 'bg-background',
  accent: 'bg-sky-500/6',
  success: 'bg-emerald-500/6',
  warning: 'bg-amber-500/7',
  danger: 'bg-rose-500/6',
}

const trailStatusStyles: Record<
  DocumentTrailStatus,
  { dot: string; badge: string; border: string; background: string }
> = {
  complete: {
    dot: 'bg-emerald-600',
    badge: 'border-emerald-500/30 text-emerald-700',
    border: 'border-emerald-500/25',
    background: 'bg-emerald-500/5',
  },
  active: {
    dot: 'bg-sky-600',
    badge: 'border-sky-500/30 text-sky-700',
    border: 'border-sky-500/25',
    background: 'bg-sky-500/5',
  },
  pending: {
    dot: 'bg-border',
    badge: 'border-border/70 text-muted-foreground',
    border: 'border-border/70',
    background: 'bg-background',
  },
  error: {
    dot: 'bg-rose-600',
    badge: 'border-rose-500/30 text-rose-700',
    border: 'border-rose-500/25',
    background: 'bg-rose-500/5',
  },
}

const logLevelStyles: Record<DocumentLogLevel, string> = {
  info: 'border-border/70 text-muted-foreground',
  warning: 'border-amber-500/30 text-amber-700',
  error: 'border-rose-500/30 text-rose-700',
}

const compactTrailLabels: Record<string, string> = {
  'OCR / Layout': 'OCR',
  'AI Normalize': 'AI',
  'Masterlist Check': 'Masterlist',
  'Validation + Variance': 'Validate',
  Deduplication: 'Dedupe',
  'Rename + Persist': 'Persist',
  Reconciliation: 'Reconcile',
  Signing: 'Sign',
}

const formatBytes = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return '—'
  }

  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const toDocumentKindLabel = (kind: OperationalDocumentView['kind']) =>
  kind === 'upload' ? 'Upload batch' : 'Certificate'

export const getDocumentBackTo = (
  document: OperationalDocumentView | null,
): '/upload' | '/validated' | '/issues' => {
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
}

export const toDocumentDetailViewModel = (
  document: OperationalDocumentView,
): DocumentDetailViewModel => {
  const metadataItems: Array<DetailField> = [
    {
      label: 'Kind',
      value: toDocumentKindLabel(document.kind),
      tone: 'accent',
    },
    {
      label: 'Stage',
      value: document.stage || '—',
      tone: document.status === 'Ready' ? 'success' : 'warning',
      size: 'emphasis',
    },
    {
      label: 'Owner',
      value: document.owner || '—',
    },
    {
      label: 'Updated',
      value: document.updatedAt || '—',
    },
    {
      label: 'Period',
      value: document.period || '—',
      tone: 'accent',
      size: 'emphasis',
    },
    {
      label: 'Payee',
      value: document.payee || '—',
      span: 'full',
      size: 'emphasis',
    },
    {
      label: 'ATC',
      value: document.atc || '—',
    },
    {
      label: 'Tax base',
      value: document.taxBase || '—',
      tone: 'warning',
      size: 'emphasis',
    },
    {
      label: 'Tax withheld',
      value: document.taxWithheld || '—',
      tone: document.status === 'Error' ? 'danger' : 'neutral',
      size: 'emphasis',
    },
    {
      label: 'Confidence',
      value: document.confidence || '—',
      tone: 'success',
    },
  ]

  if (document.kind === 'certificate') {
    metadataItems.push({
      label: 'Signing status',
      value:
        document.signingStatus === 'signed'
          ? 'Signed'
          : document.signingStatus === 'failed'
            ? 'Failed'
            : 'Unsigned',
      tone:
        document.signingStatus === 'signed'
          ? 'success'
          : document.signingStatus === 'failed'
            ? 'danger'
            : 'warning',
    })

    if (document.signedAt) {
      metadataItems.push({
        label: 'Signed at',
        value: document.signedAt,
      })
    }

    if (document.signedByName) {
      metadataItems.push({
        label: 'Signed by',
        value: document.signedByName,
      })
    }
  }

  if (document.removedFromBatchAt) {
    metadataItems.splice(2, 0, {
      label: 'Batch tracking',
      value: `Removed from batch ${document.removedFromBatchAt}`,
      tone: 'warning',
      span: 'full',
    })
  }

  return {
    fileName: document.fileName,
    summaryMeta: [
      formatBytes(document.sizeBytes),
      `Uploaded ${document.uploadedAt || '—'}`,
      `by ${document.owner || 'Unknown uploader'}`,
    ],
    metadataItems,
    processingSummaryItems: [
      {
        label: 'Started',
        value: document.processing?.startedAt || '—',
      },
      {
        label: 'Last update',
        value: document.processing?.updatedAt || '—',
      },
      {
        label: 'Elapsed',
        value: document.processing?.elapsed || '—',
      },
    ],
  }
}

export function DocumentDetailPage({
  document,
  isLoading,
  loadError,
  onResolveAttention,
  canDownloadSignedPdf = false,
}: DocumentDetailPageProps) {
  const viewModel = document ? toDocumentDetailViewModel(document) : null

  return (
    <div className="flex flex-col gap-4">
      <section
        className={cn('overflow-hidden rounded-lg bg-card', PANEL_CARD_CLASS)}
      >
        <div className="flex flex-col gap-4 p-3 sm:p-4">
          {isLoading ? (
            <StateCard tone="neutral">Loading document detail…</StateCard>
          ) : loadError ? (
            <StateCard tone="danger">{loadError}</StateCard>
          ) : !document || !viewModel ? (
            <StateCard tone="neutral">Document not found.</StateCard>
          ) : (
            <>
              <DocumentSummaryBand
                document={document}
                viewModel={viewModel}
                onResolveAttention={onResolveAttention}
                canDownloadSignedPdf={canDownloadSignedPdf}
              />
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.48fr)_minmax(20rem,0.88fr)]">
                <div className="flex min-w-0 flex-col gap-3">
                  <DocumentMetadataCard items={viewModel.metadataItems} />
                  <ProcessingTrailCard document={document} />
                </div>
                <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-6 xl:self-start">
                  <ProcessingSummaryCard
                    items={viewModel.processingSummaryItems}
                  />
                  <ErrorsCard document={document} />
                  <EventLogsCard document={document} />
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

export function DocumentSummaryBand({
  document,
  viewModel,
  onResolveAttention,
  canDownloadSignedPdf = false,
}: {
  document: OperationalDocumentView
  viewModel: DocumentDetailViewModel
  onResolveAttention?: () => void
  canDownloadSignedPdf?: boolean
}) {
  const shouldShowResolveAction =
    Boolean(onResolveAttention) &&
    document.kind === 'upload' &&
    document.attentionStatus !== 'resolved' &&
    (document.status === 'Duplicate' || document.status === 'Error')
  const shouldShowSignedPdfAction =
    Boolean(document.uploadBatchId) &&
    document.signingStatus === 'signed' &&
    (document.kind === 'upload' || Boolean(document.signedPdfUrl))
  const shouldShowNextStepBadge = !(
    shouldShowSignedPdfAction && document.nextStep === 'View signed batch'
  )

  return (
    <section aria-labelledby="document-summary-title">
      <Card size="sm" className={cn('rounded-lg', PANEL_CARD_CLASS)}>
        <CardContent className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/20 text-muted-foreground',
                PANEL_BORDER_CLASS,
              )}
            >
              <IconFileDescription className="size-5" />
            </div>
            <div className="min-w-0">
              <p
                id="document-summary-title"
                className="break-words text-sm font-semibold sm:text-base"
              >
                {viewModel.fileName}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {viewModel.summaryMeta.map((item, index) => (
                  <span
                    key={`${item}-${index}`}
                    className="inline-flex items-center"
                  >
                    {index > 0 ? (
                      <span aria-hidden="true" className="mr-2 text-border">
                        •
                      </span>
                    ) : null}
                    <span>{item}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
            <StatusPill status={document.status} />
            {document.kind === 'certificate' ? (
              <Badge variant="outline">
                {document.signingStatus === 'signed'
                  ? 'Signed'
                  : document.signingStatus === 'failed'
                    ? 'Signing failed'
                    : 'Unsigned'}
              </Badge>
            ) : null}
            {document.removedFromBatchAt ? (
              <Badge variant="outline">
                Removed from batch {document.removedFromBatchAt}
              </Badge>
            ) : null}
            {shouldShowNextStepBadge ? (
              <Badge variant="outline">{document.nextStep}</Badge>
            ) : null}
            {shouldShowSignedPdfAction ? (
              <Link
                to="/upload/batches/$batchId/sign"
                params={{ batchId: document.uploadBatchId ?? '' }}
                className={buttonVariants({ size: 'xs', variant: 'outline' })}
              >
                {document.kind === 'upload'
                  ? 'View signed batch'
                  : 'View signed PDF'}
              </Link>
            ) : null}
            {canDownloadSignedPdf &&
            document.kind === 'certificate' &&
            document.signingStatus === 'signed' &&
            document.signedPdfUrl ? (
              <a
                href={`/api/documents/${encodeURIComponent(
                  document.id,
                )}/signed-pdf`}
                className={buttonVariants({ size: 'xs', variant: 'outline' })}
              >
                <IconDownload data-icon="inline-start" />
                Download signed PDF
              </a>
            ) : null}
            {shouldShowResolveAction ? (
              <Button size="xs" variant="outline" onClick={onResolveAttention}>
                Mark resolved
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

export function DocumentMetadataCard({ items }: { items: Array<DetailField> }) {
  return (
    <DetailCard
      title="Document metadata"
      description="High-signal fields for review and export."
      icon={<IconFileAnalytics className="size-4" />}
    >
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className={cn(
              'rounded-lg border px-3 py-2.5',
              PANEL_BORDER_CLASS,
              fieldSurfaceStyles[item.tone ?? 'neutral'],
              item.span === 'full' && 'sm:col-span-2 xl:col-span-2',
            )}
          >
            <dt className="text-xs font-medium text-muted-foreground">
              {item.label}
            </dt>
            <dd
              className={cn(
                'mt-1 break-words text-sm font-semibold',
                fieldToneStyles[item.tone ?? 'neutral'],
              )}
            >
              {item.value || '—'}
            </dd>
          </div>
        ))}
      </dl>
    </DetailCard>
  )
}

export function ProcessingTrailCard({
  document,
}: {
  document: OperationalDocumentView
}) {
  return (
    <DetailCard
      title="Processing trail"
      description="Pipeline steps derived from queue, worker, and result state."
      icon={<IconTimeline className="size-4" />}
    >
      <ProcessingTrailStepper steps={document.trail} />
      <details className="group mt-3">
        <summary
          className={cn(
            'flex cursor-pointer list-none items-center justify-end gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs font-medium text-foreground marker:hidden',
            PANEL_BORDER_CLASS,
          )}
        >
          Show details
          <IconChevronDown className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3">
          <ProcessingTrailExpandedList
            details={document.trailDetails ?? []}
            fallbackSteps={document.trail}
          />
        </div>
      </details>
    </DetailCard>
  )
}

export function ProcessingTrailStepper({
  steps,
}: {
  steps: OperationalDocumentView['trail']
}) {
  return (
    <ol
      className="grid grid-cols-[repeat(var(--trail-step-count),minmax(4.5rem,1fr))] gap-2 overflow-x-auto pb-1 md:grid-cols-[repeat(var(--trail-step-count),minmax(0,1fr))] md:overflow-visible"
      style={
        {
          '--trail-step-count': steps.length,
        } as CSSProperties
      }
      aria-label="Processing steps"
    >
      {steps.map((step, index) => {
        const styles = trailStatusStyles[step.status]
        const compactLabel = compactTrailLabels[step.label] ?? step.label

        return (
          <li
            key={step.label}
            className="relative flex min-w-0 flex-col items-center gap-2 text-center"
          >
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute left-[calc(50%+0.875rem)] top-[0.4375rem] h-px w-[calc(100%-1.75rem)] bg-border/80"
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                'relative z-10 flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-background',
                styles.dot,
              )}
            >
              {step.status === 'complete' ? (
                <IconCheck className="size-2.5 text-white" />
              ) : null}
            </span>
            <span
              className="block w-full truncate whitespace-nowrap text-center text-[11px] leading-4 font-medium text-foreground"
              title={step.label}
            >
              {compactLabel}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function ProcessingTrailExpandedList({
  details,
  fallbackSteps,
}: {
  details: NonNullable<OperationalDocumentView['trailDetails']>
  fallbackSteps: OperationalDocumentView['trail']
}) {
  const rows =
    details.length > 0
      ? details
      : fallbackSteps.map((step) => ({
          label: step.label,
          timestamp: '—',
          description: step.detail || 'No detail recorded.',
          status: step.status,
        }))

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-background',
        PANEL_BORDER_CLASS,
      )}
    >
      <div
        className={cn(
          'hidden grid-cols-[minmax(0,0.9fr)_11rem_minmax(0,1.2fr)_auto] items-center gap-2 border-b bg-muted/35 px-3 py-2 text-xs font-medium text-muted-foreground md:grid',
          PANEL_BORDER_CLASS,
        )}
      >
        <span>Stage</span>
        <span>Timestamp</span>
        <span>Description</span>
        <span className="justify-self-end">Status</span>
      </div>
      {rows.map((detail) => {
        const styles = trailStatusStyles[detail.status]

        return (
          <div
            key={detail.label}
            className="grid gap-2 border-b border-border/70 px-3 py-2 last:border-b-0 md:grid-cols-[minmax(0,0.9fr)_11rem_minmax(0,1.2fr)_auto] md:items-start"
          >
            <div>
              <p className="text-xs font-medium text-foreground">
                {detail.label}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">{detail.timestamp}</p>
            <p className="text-xs text-muted-foreground">
              {detail.description}
            </p>
            <div className="md:justify-self-end">
              <Badge variant="outline" className={cn('text-xs', styles.badge)}>
                {detail.status}
              </Badge>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ProcessingSummaryCard({
  items,
}: {
  items: Array<SummaryItem>
}) {
  return (
    <DetailCard
      title="Processing summary"
      description="Worker timings and current execution context."
      tone="secondary"
      icon={<IconClockHour4 className="size-4" />}
    >
      <dl
        className={cn(
          'overflow-hidden rounded-lg border bg-background',
          PANEL_BORDER_CLASS,
        )}
      >
        {items.map((item) => (
          <div
            key={item.label}
            className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-3 border-b border-border/70 px-3 py-2 last:border-b-0"
          >
            <dt className="text-xs font-medium text-muted-foreground">
              {item.label}
            </dt>
            <dd className="text-xs font-semibold text-foreground">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </DetailCard>
  )
}

export function ErrorsCard({
  document,
}: {
  document: OperationalDocumentView
}) {
  const hasErrors = document.errors.length > 0

  return (
    <DetailCard
      title="Errors"
      description="Validation failures or duplicate reasons."
      tone="secondary"
      icon={<IconShieldExclamation className="size-4" />}
    >
      {hasErrors ? (
        <div className="grid gap-2">
          {document.errors.map((error, index) => (
            <Link
              key={`${error.code}-${error.stage}`}
              to="/error-detail"
              search={{
                docId: document.id,
                errorIndex: String(index),
              }}
              className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 transition-colors hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/20 bg-background text-rose-700">
                    <IconShieldExclamation className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-rose-800">
                      {error.code} · {error.stage}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-rose-950">
                      {error.message}
                    </p>
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-rose-700">
                  Review
                  <IconChevronRight className="size-4" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-xs text-emerald-800">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-emerald-500/25 bg-background">
            <IconCheck className="size-3.5" />
          </div>
          <div>
            <p className="font-medium">No errors flagged.</p>
          </div>
        </div>
      )}
    </DetailCard>
  )
}

export function EventLogsCard({
  document,
}: {
  document: OperationalDocumentView
}) {
  return (
    <DetailCard
      title="Event logs"
      description="Chronological audit trail from upload through worker processing."
      tone="secondary"
      icon={<IconListDetails className="size-4" />}
    >
      {document.logs.length > 0 ? (
        <details className="group">
          {document.logs.length > LOG_PREVIEW_COUNT ? (
            <summary
              className={cn(
                'mb-3 flex cursor-pointer list-none items-center justify-end rounded-lg border bg-muted/20 px-3 py-2 text-xs font-medium text-foreground marker:hidden',
                PANEL_BORDER_CLASS,
              )}
            >
              Show more
            </summary>
          ) : null}
          <div
            className={cn(
              'overflow-hidden rounded-lg border bg-background group-open:hidden',
              PANEL_BORDER_CLASS,
            )}
          >
            {document.logs.slice(0, LOG_PREVIEW_COUNT).map((log, index) => (
              <LogRow key={`${log.timestamp}-${index}`} log={log} />
            ))}
          </div>
          <div
            className={cn(
              'hidden overflow-hidden rounded-lg border bg-background group-open:block',
              PANEL_BORDER_CLASS,
            )}
          >
            {document.logs.map((log, index) => (
              <LogRow key={`${log.timestamp}-${index}`} log={log} />
            ))}
          </div>
        </details>
      ) : (
        <p className="text-xs text-muted-foreground">No logs captured yet.</p>
      )}
    </DetailCard>
  )
}

function LogRow({ log }: { log: OperationalDocumentView['logs'][number] }) {
  return (
    <div className="grid gap-2 border-b border-border/70 px-3 py-2 text-xs last:border-b-0 md:grid-cols-[9.5rem_auto_minmax(0,1fr)] md:items-start">
      <span className="text-xs text-muted-foreground">{log.timestamp}</span>
      <Badge
        variant="outline"
        className={cn(
          'h-5 w-fit rounded-md px-1.5 text-[10px] font-semibold uppercase tracking-wide',
          logLevelStyles[log.level],
        )}
      >
        {log.level}
      </Badge>
      <p className="text-xs text-foreground">{log.message}</p>
    </div>
  )
}

function DetailCard({
  title,
  description,
  icon,
  action,
  tone = 'primary',
  children,
}: {
  title: string
  description: string
  icon?: ReactNode
  action?: ReactNode
  tone?: 'primary' | 'secondary'
  children: ReactNode
}) {
  return (
    <Card
      size="sm"
      className={cn(
        'rounded-lg',
        PANEL_CARD_CLASS,
        tone === 'secondary' ? 'bg-muted/10' : 'bg-card',
      )}
    >
      <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? (
              <div
                className={cn(
                  'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground',
                  PANEL_BORDER_CLASS,
                )}
              >
                {icon}
              </div>
            ) : null}
            <div>
              <CardTitle className="text-sm">{title}</CardTitle>
              <CardDescription className="mt-1 text-xs">
                {description}
              </CardDescription>
            </div>
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function StateCard({
  tone,
  children,
}: {
  tone: 'neutral' | 'danger'
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-5 text-sm',
        tone === 'danger'
          ? 'border-rose-500/20 bg-rose-500/10 text-rose-700'
          : 'border-border/70 bg-muted/20 text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}
