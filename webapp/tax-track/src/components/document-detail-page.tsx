import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClockHour4,
  IconFileAnalytics,
  IconFileDescription,
  IconFiles,
  IconListDetails,
  IconShieldExclamation,
  IconStack2,
  IconTimeline,
} from '@tabler/icons-react'
import type { ReactNode } from 'react'

import type {
  DocumentLogLevel,
  DocumentTrailStatus,
  OperationalDocumentView,
} from '@/lib/documents-types'
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
import { cn } from '@/lib/utils'

const LOG_PREVIEW_COUNT = 6

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
  isResolvingAttention?: boolean
  onResolveAttention?: () => void
}

type DocumentDetailViewModel = {
  fileName: string
  summaryMeta: Array<string>
  primaryAction?: {
    label: string
    docId: string
  }
  canResolveAttention: boolean
  attentionResolvedAt?: string
  batchSummaryItems?: Array<SummaryItem>
  metadataItems: Array<DetailField>
  generatedCertificates: NonNullable<
    OperationalDocumentView['relatedDocuments']
  >
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

const formatBytes = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return '—'
  }

  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const formatPageList = (pages: Array<number>) =>
  pages.length > 0 ? pages.map((page) => `Page ${page}`).join(', ') : '—'

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

  if (document.pageNumber !== null) {
    metadataItems.splice(1, 0, {
      label: 'Page',
      value: String(document.pageNumber),
    })
  }

  const batchSummaryItems = document.batchSummary
    ? [
        {
          label: 'Total pages',
          value: String(document.batchSummary.totalPages),
        },
        {
          label: 'Certificate pages',
          value: String(document.batchSummary.certificatePageNumbers.length),
        },
        {
          label: 'Ignored pages',
          value: formatPageList(document.batchSummary.ignoredPageNumbers),
        },
        {
          label: 'Failed pages',
          value: formatPageList(document.batchSummary.failedPageNumbers),
        },
        {
          label: 'Duplicate pages',
          value: formatPageList(document.batchSummary.duplicatePageNumbers),
        },
      ]
    : undefined

  const generatedCertificates = document.relatedDocuments ?? []
  const primaryAction =
    generatedCertificates.length > 0
      ? {
          label: 'Review generated certificate results',
          docId: generatedCertificates[0].id,
        }
      : undefined

  const canResolveAttention =
    document.kind === 'upload' &&
    (document.status === 'Duplicate' || document.status === 'Error') &&
    document.attentionStatus !== 'resolved'

  return {
    fileName: document.fileName,
    summaryMeta: [
      formatBytes(document.sizeBytes),
      `Uploaded ${document.uploadedAt || '—'}`,
      `by ${document.owner || 'Unknown uploader'}`,
    ],
    primaryAction,
    canResolveAttention,
    attentionResolvedAt:
      document.attentionStatus === 'resolved'
        ? document.attentionResolvedAt
        : undefined,
    batchSummaryItems,
    metadataItems,
    generatedCertificates,
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
  isResolvingAttention = false,
  onResolveAttention,
}: DocumentDetailPageProps) {
  const viewModel = useMemo(
    () => (document ? toDocumentDetailViewModel(document) : null),
    [document],
  )

  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-[28px] border border-border/70 bg-card">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
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
                isResolvingAttention={isResolvingAttention}
                onResolveAttention={onResolveAttention}
              />
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.48fr)_minmax(20rem,0.88fr)]">
                <div className="flex min-w-0 flex-col gap-4">
                  {viewModel.batchSummaryItems ? (
                    <BatchSummaryCard items={viewModel.batchSummaryItems} />
                  ) : null}
                  <DocumentMetadataCard items={viewModel.metadataItems} />
                  <GeneratedCertificatesCard
                    relatedDocuments={viewModel.generatedCertificates}
                  />
                  <ProcessingTrailCard document={document} />
                </div>
                <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
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
  isResolvingAttention = false,
  onResolveAttention,
}: {
  document: OperationalDocumentView
  viewModel: DocumentDetailViewModel
  isResolvingAttention?: boolean
  onResolveAttention?: () => void
}) {
  return (
    <section aria-labelledby="document-summary-title">
      <Card className="border-border/60 bg-card shadow-none">
        <CardContent className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/6 text-rose-600">
              <IconFileDescription className="size-5" />
            </div>
            <div className="min-w-0">
              <p
                id="document-summary-title"
                className="break-words text-base font-semibold tracking-tight sm:text-lg"
              >
                {viewModel.fileName}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
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
            {viewModel.canResolveAttention ? (
              <Button
                type="button"
                size="sm"
                onClick={onResolveAttention}
                disabled={!onResolveAttention || isResolvingAttention}
              >
                {isResolvingAttention ? 'Resolving…' : 'Mark resolved'}
              </Button>
            ) : null}
            {viewModel.attentionResolvedAt ? (
              <Badge
                variant="outline"
                className="px-3 py-1 text-xs font-normal"
              >
                Resolved {viewModel.attentionResolvedAt}
              </Badge>
            ) : null}
            {viewModel.primaryAction ? (
              <Button size="sm" variant="outline" asChild>
                <Link
                  to="/documents/$docId"
                  params={{ docId: viewModel.primaryAction.docId }}
                >
                  {viewModel.primaryAction.label}
                </Link>
              </Button>
            ) : (
              <Badge
                variant="outline"
                className="px-3 py-1 text-xs font-normal"
              >
                {document.nextStep}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

export function BatchSummaryCard({ items }: { items: Array<SummaryItem> }) {
  return (
    <DetailCard
      title="Batch summary"
      description="Page-level detection and validation outcome for this upload."
      icon={<IconStack2 className="size-4" />}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {items.map((item, index) => (
          <SummaryTile
            key={item.label}
            item={item}
            tone={index === 1 ? 'success' : 'neutral'}
          />
        ))}
      </div>
    </DetailCard>
  )
}

export function DocumentMetadataCard({ items }: { items: Array<DetailField> }) {
  return (
    <DetailCard
      title="Document metadata"
      description="High-signal fields for review and export."
      icon={<IconFileAnalytics className="size-4" />}
    >
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className={cn(
              'rounded-xl border border-border/60 px-3 py-3',
              fieldSurfaceStyles[item.tone ?? 'neutral'],
              item.span === 'full' && 'sm:col-span-2 xl:col-span-2',
            )}
          >
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/90">
              {item.label}
            </dt>
            <dd
              className={cn(
                'mt-1.5 break-words font-semibold',
                item.size === 'emphasis'
                  ? 'text-base tracking-tight'
                  : 'text-sm',
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

export function GeneratedCertificatesCard({
  relatedDocuments,
}: {
  relatedDocuments: NonNullable<OperationalDocumentView['relatedDocuments']>
}) {
  return (
    <DetailCard
      title="Generated certificates"
      description="Downstream certificate results associated with this upload."
      icon={<IconFiles className="size-4" />}
    >
      {relatedDocuments.length > 0 ? (
        <div className="grid gap-2.5">
          {relatedDocuments.map((related) => (
            <div
              key={related.id}
              className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background px-3 py-3 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {related.pageNumber !== null
                    ? `Certificate page ${related.pageNumber}`
                    : related.label}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={related.status} />
                <Button size="sm" variant="outline" asChild>
                  <Link to="/documents/$docId" params={{ docId: related.id }}>
                    View certificate
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No generated certificates are available for this upload yet.
        </p>
      )}
    </DetailCard>
  )
}

export function ProcessingTrailCard({
  document,
}: {
  document: OperationalDocumentView
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <DetailCard
      title="Processing trail"
      description="Pipeline steps derived from queue, worker, and result state."
      icon={<IconTimeline className="size-4" />}
      action={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? 'Collapse' : 'Expand'}
          <IconChevronDown
            data-icon="inline-end"
            className={cn('transition-transform', isExpanded && 'rotate-180')}
          />
        </Button>
      }
    >
      <ProcessingTrailStepper steps={document.trail} />
      {isExpanded ? (
        <div className="mt-4">
          <ProcessingTrailExpandedList
            details={document.trailDetails ?? []}
            fallbackSteps={document.trail}
          />
        </div>
      ) : null}
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
      className="grid gap-3 md:grid-cols-3 xl:grid-cols-9 xl:gap-2"
      aria-label="Processing steps"
    >
      {steps.map((step, index) => {
        const styles = trailStatusStyles[step.status]

        return (
          <li
            key={step.label}
            className="relative flex min-w-0 flex-col items-center gap-2 text-center"
          >
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute left-[calc(50%+0.875rem)] top-[0.4375rem] hidden h-px w-[calc(100%-1.75rem)] bg-border/80 xl:block"
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
            <span className="text-xs font-medium leading-4 text-foreground">
              {step.label}
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
    <div className="overflow-hidden rounded-xl border border-border/60 bg-background">
      <div className="hidden grid-cols-[minmax(0,0.9fr)_11rem_minmax(0,1.2fr)_auto] items-center gap-2 border-b border-border/60 bg-muted/20 px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground md:grid">
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
            className="grid gap-2 border-b border-border/50 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,0.9fr)_11rem_minmax(0,1.2fr)_auto] md:items-start"
          >
            <div>
              <p className="text-sm font-medium text-foreground">
                {detail.label}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">{detail.timestamp}</p>
            <p className="text-sm text-muted-foreground">
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
      <dl className="overflow-hidden rounded-xl border border-border/60 bg-background">
        {items.map((item) => (
          <div
            key={item.label}
            className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-3 border-b border-border/50 px-3 py-3 last:border-b-0"
          >
            <dt className="text-sm font-medium text-muted-foreground">
              {item.label}
            </dt>
            <dd className="text-sm font-semibold text-foreground">
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
        <div className="grid gap-2.5">
          {document.errors.map((error, index) => (
            <Link
              key={`${error.code}-${error.stage}`}
              to="/error-detail"
              search={{
                docId: document.id,
                errorIndex: String(index),
              }}
              className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-3 transition-colors hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/20 bg-background text-rose-700">
                    <IconShieldExclamation className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-rose-800">
                      {error.code} · {error.stage}
                    </p>
                    <p className="mt-1 text-sm text-rose-950">
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
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-sm text-emerald-800">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/25 bg-background">
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
  const [isExpanded, setIsExpanded] = useState(false)
  const visibleLogs = isExpanded
    ? document.logs
    : document.logs.slice(0, LOG_PREVIEW_COUNT)

  return (
    <DetailCard
      title="Event logs"
      description="Chronological audit trail from upload through worker processing."
      tone="secondary"
      icon={<IconListDetails className="size-4" />}
      action={
        document.logs.length > LOG_PREVIEW_COUNT ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((current) => !current)}
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </Button>
        ) : null
      }
    >
      {document.logs.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-background">
          {visibleLogs.map((log, index) => (
            <div
              key={`${log.timestamp}-${index}`}
              className="grid gap-2 border-b border-border/50 px-3 py-3 text-sm last:border-b-0 md:grid-cols-[9.5rem_auto_minmax(0,1fr)] md:items-start"
            >
              <span className="text-xs text-muted-foreground">
                {log.timestamp}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  'h-5 w-fit rounded-md px-1.5 text-[10px] font-semibold uppercase tracking-wide',
                  logLevelStyles[log.level],
                )}
              >
                {log.level}
              </Badge>
              <p className="text-sm text-foreground">{log.message}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No logs captured yet.</p>
      )}
    </DetailCard>
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
      className={cn(
        'rounded-2xl border-border/60 shadow-none',
        tone === 'secondary' ? 'bg-muted/15' : 'bg-card',
      )}
    >
      <CardHeader className="gap-3 border-b border-border/50 px-4 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? (
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground">
                {icon}
              </div>
            ) : null}
            <div>
              <CardTitle className="text-base font-semibold tracking-tight">
                {title}
              </CardTitle>
              <CardDescription className="mt-1 text-sm">
                {description}
              </CardDescription>
            </div>
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="px-4 pt-4">{children}</CardContent>
    </Card>
  )
}

function SummaryTile({
  item,
  tone = 'neutral',
}: {
  item: SummaryItem
  tone?: FieldTone
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/90">
        {item.label}
      </p>
      <p
        className={cn(
          'mt-2 text-lg font-semibold tracking-tight',
          fieldToneStyles[tone],
        )}
      >
        {item.value}
      </p>
    </div>
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
        'rounded-2xl border px-4 py-6 text-sm',
        tone === 'danger'
          ? 'border-rose-500/20 bg-rose-500/10 text-rose-700'
          : 'border-border/70 bg-muted/30 text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}
