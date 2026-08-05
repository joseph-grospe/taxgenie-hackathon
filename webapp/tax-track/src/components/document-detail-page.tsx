import { Link } from '@tanstack/react-router'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClockHour4,
  IconDotsVertical,
  IconDownload,
  IconFileAnalytics,
  IconFileDescription,
  IconListCheck,
  IconListDetails,
  IconShieldExclamation,
  IconTimeline,
  IconTrash,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import type { CSSProperties, FormEvent, ReactNode } from 'react'

import type {
  DocumentLogLevel,
  DocumentMergeAssignmentView,
  DocumentTrailStatus,
  OperationalDocumentView,
} from '@/lib/documents-types'
import { defaultBatchDetailSearch } from '@/lib/batch-file-search-state'
import { ExtractionRetryAction } from '@/components/extraction-retry-action'
import { OriginalPdfViewer } from '@/components/original-pdf-viewer'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const LOG_PREVIEW_COUNT = 6
const ORIGINAL_PDF_PANEL_ID = 'document-original-pdf-panel'
const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'
const PANEL_BORDER_CLASS = 'border-border/60'

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
  canDownloadSignedPdf?: boolean
  canAccessSigning?: boolean
  canRequestOverride?: boolean
  onOverrideRequested?: () => void | Promise<void>
  canManageMergeAssignments?: boolean
  onMergeAssignmentUpdated?: () => void | Promise<void>
  isOriginalPreviewOpen?: boolean
  hasOpenedOriginalPreview?: boolean
  onOriginalPreviewOpenChange?: (open: boolean) => void
  isRetryingExtraction?: boolean
  onRetryExtraction?: () => void
  deletionAction?: DocumentDeletionAction
}

type DocumentDeletionAction = {
  label: 'Delete file' | 'Retry deletion'
  disabled?: boolean
  disabledReason?: string
  onSelect: () => void
}

type DocumentDetailViewModel = {
  fileName: string
  summaryMeta: Array<string>
  metadataItems: Array<DetailField>
  processingSummaryItems: Array<SummaryItem>
}

type DocumentSummaryAction =
  | {
      kind: 'signed-workspace'
      id: string
      label: string
      batchId: string
    }
  | {
      kind: 'review-issue'
      id: string
      label: string
      documentId: string
      errorIndex: string
    }
  | {
      kind: 'download-signed-pdf'
      id: string
      label: string
      href: string
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
  'Agent extraction': 'Extract',
  'Certificate validation': 'Validate',
  'Persist results': 'Persist',
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

const TAX_AMOUNT_FORMATTER = new Intl.NumberFormat('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatTaxRowAmount = (value: string | null) => {
  if (value === null) return '—'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? TAX_AMOUNT_FORMATTER.format(numeric) : '—'
}

const formatTaxRowRate = (value: string | null) => {
  if (value === null) return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  return `${(numeric * 100).toLocaleString('en-PH', {
    maximumFractionDigits: 4,
  })}%`
}

const toDocumentKindLabel = (kind: OperationalDocumentView['kind']) =>
  kind === 'upload' ? 'Upload batch' : 'Certificate'

const getSigningStatusLabel = (
  status: OperationalDocumentView['signingStatus'],
) =>
  status === 'signed'
    ? 'Signed'
    : status === 'failed'
      ? 'Signing failed'
      : 'Unsigned'

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
  ]

  if (document.kind === 'certificate') {
    if (document.override?.status === 'approved') {
      metadataItems.push({
        label: 'Override',
        value: document.override.decidedByName
          ? `Approved by ${document.override.decidedByName}`
          : 'Approved',
        tone: 'warning',
      })
    }

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

    const mergeAssignments = document.mergeAssignments ?? []

    if (mergeAssignments.length > 0) {
      metadataItems.push({
        label: 'Merge assignment',
        value: mergeAssignments
          .map((assignment) => {
            const stream =
              assignment.packageType === 'annual' ? 'Annual' : 'Quarterly'
            const lateLabel = assignment.isLate ? 'late, ' : ''
            return `${stream}: ${lateLabel}${assignment.sourcePeriod} -> ${assignment.assignedPeriod}`
          })
          .join(' | '),
        tone: mergeAssignments.some(
          (assignment) => assignment.status === 'manual_review',
        )
          ? 'warning'
          : mergeAssignments.some((assignment) => assignment.isLate)
            ? 'accent'
            : 'neutral',
        span: 'full',
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
  canDownloadSignedPdf = false,
  canAccessSigning = false,
  canRequestOverride = false,
  onOverrideRequested,
  canManageMergeAssignments = false,
  onMergeAssignmentUpdated,
  isOriginalPreviewOpen = false,
  hasOpenedOriginalPreview = false,
  onOriginalPreviewOpenChange,
  isRetryingExtraction = false,
  onRetryExtraction,
  deletionAction,
}: DocumentDetailPageProps) {
  const viewModel = document ? toDocumentDetailViewModel(document) : null
  const hasOriginalPdf = document?.canDownloadOriginalFile !== false
  const shouldShowOriginalPreview =
    Boolean(document) && hasOriginalPdf && hasOpenedOriginalPreview
  const shouldOpenOriginalPreview =
    shouldShowOriginalPreview && isOriginalPreviewOpen

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
                canDownloadSignedPdf={canDownloadSignedPdf}
                canAccessSigning={canAccessSigning}
                isOriginalPreviewOpen={shouldOpenOriginalPreview}
                onOriginalPreviewOpenChange={onOriginalPreviewOpenChange}
                deletionAction={deletionAction}
              />
              {shouldShowOriginalPreview ? (
                <OriginalPdfViewer
                  fileName={viewModel.fileName}
                  isVisible={shouldOpenOriginalPreview}
                  onOpenChange={onOriginalPreviewOpenChange}
                  panelId={ORIGINAL_PDF_PANEL_ID}
                  sourceUrl={`/api/documents/${encodeURIComponent(
                    document.id,
                  )}/original-preview`}
                />
              ) : null}
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.48fr)_minmax(20rem,0.88fr)]">
                <div className="flex min-w-0 flex-col gap-3">
                  <DocumentMetadataCard items={viewModel.metadataItems} />
                  <ManualReviewMergeAssignmentsCard
                    document={document}
                    canManageMergeAssignments={canManageMergeAssignments}
                    onAssignmentUpdated={onMergeAssignmentUpdated}
                  />
                  <ExtractedFieldsCard document={document} />
                  <TaxRowsCard document={document} />
                  <ProcessingTrailCard document={document} />
                </div>
                <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-6 xl:self-start">
                  <ProcessingSummaryCard
                    items={viewModel.processingSummaryItems}
                  />
                  <ErrorsCard
                    document={document}
                    canRequestOverride={canRequestOverride}
                    onOverrideRequested={onOverrideRequested}
                    isRetryingExtraction={isRetryingExtraction}
                    onRetryExtraction={onRetryExtraction}
                  />
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
  canDownloadSignedPdf = false,
  canAccessSigning = false,
  isOriginalPreviewOpen = false,
  onOriginalPreviewOpenChange,
  deletionAction,
}: {
  document: OperationalDocumentView
  viewModel: DocumentDetailViewModel
  canDownloadSignedPdf?: boolean
  canAccessSigning?: boolean
  isOriginalPreviewOpen?: boolean
  onOriginalPreviewOpenChange?: (open: boolean) => void
  deletionAction?: DocumentDeletionAction
}) {
  const shouldShowSignedPdfAction =
    canAccessSigning &&
    Boolean(document.uploadBatchId) &&
    document.signingStatus === 'signed' &&
    (document.kind === 'upload' || Boolean(document.signedPdfUrl))
  const shouldShowNextStepLabel = !(
    shouldShowSignedPdfAction && document.nextStep === 'View signed batch'
  )
  const summaryActions = buildDocumentSummaryActions({
    document,
    shouldShowSignedPdfAction,
    canDownloadSignedPdf,
  })
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
              <DocumentSummaryStatusStrip
                document={document}
                showNextStep={shouldShowNextStepLabel}
              />
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <DocumentSummaryActionGroup
              actions={summaryActions}
              deletionAction={deletionAction}
              renderMenu={false}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={document.canDownloadOriginalFile === false}
              aria-controls={ORIGINAL_PDF_PANEL_ID}
              aria-expanded={isOriginalPreviewOpen}
              onClick={() =>
                onOriginalPreviewOpenChange?.(!isOriginalPreviewOpen)
              }
            >
              {document.canDownloadOriginalFile === false
                ? 'Original PDF unavailable'
                : isOriginalPreviewOpen
                  ? 'Hide original PDF'
                  : 'View original PDF'}
            </Button>
            <DocumentSummaryActionGroup
              actions={summaryActions}
              deletionAction={deletionAction}
              renderPrimary={false}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function buildDocumentSummaryActions({
  document,
  shouldShowSignedPdfAction,
  canDownloadSignedPdf,
}: {
  document: OperationalDocumentView
  shouldShowSignedPdfAction: boolean
  canDownloadSignedPdf: boolean
}): Array<DocumentSummaryAction> {
  const actions: Array<DocumentSummaryAction> = []

  if (document.errors.length > 0) {
    actions.push({
      kind: 'review-issue',
      id: 'review-issue',
      label: 'Review issue',
      documentId: document.id,
      errorIndex: '0',
    })
  }

  if (shouldShowSignedPdfAction && document.uploadBatchId) {
    actions.push({
      kind: 'signed-workspace',
      id: 'signed-workspace',
      label:
        document.kind === 'upload' ? 'View signed batch' : 'View signed PDF',
      batchId: document.uploadBatchId,
    })
  }

  if (
    canDownloadSignedPdf &&
    document.kind === 'certificate' &&
    document.signingStatus === 'signed' &&
    document.signedPdfUrl
  ) {
    actions.push({
      kind: 'download-signed-pdf',
      id: 'download-signed-pdf',
      label: 'Download signed PDF',
      href: `/api/documents/${encodeURIComponent(document.id)}/signed-pdf`,
    })
  }

  return actions
}

function DocumentSummaryStatusStrip({
  document,
  showNextStep,
}: {
  document: OperationalDocumentView
  showNextStep: boolean
}) {
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill status={document.status} />
        <Badge variant="outline">{toDocumentKindLabel(document.kind)}</Badge>
        {document.kind === 'certificate' ? (
          <Badge variant="outline">
            {getSigningStatusLabel(document.signingStatus)}
          </Badge>
        ) : null}
        {document.override?.status === 'approved' ? (
          <Badge variant="secondary">Override approved</Badge>
        ) : document.override?.status === 'pending' ? (
          <Badge variant="outline">Override pending</Badge>
        ) : document.override?.status === 'rejected' ? (
          <Badge variant="destructive">Override rejected</Badge>
        ) : null}
        {document.removedFromBatchAt ? (
          <Badge variant="outline">
            Removed from batch {document.removedFromBatchAt}
          </Badge>
        ) : null}
        {document.purgeStatus === 'failed' ? (
          <Badge variant="destructive">Delete failed</Badge>
        ) : null}
      </div>
      {showNextStep ? (
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <span key="label" className="font-medium text-foreground">
            Next:
          </span>
          <span key="value">{document.nextStep}</span>
        </p>
      ) : null}
    </div>
  )
}

function DocumentSummaryActionGroup({
  actions,
  deletionAction,
  renderPrimary = true,
  renderMenu = true,
}: {
  actions: Array<DocumentSummaryAction>
  deletionAction?: DocumentDeletionAction
  renderPrimary?: boolean
  renderMenu?: boolean
}) {
  const primaryAction = actions.find(
    (action) => action.kind !== 'download-signed-pdf',
  )
  const secondaryActions = actions.filter(
    (action) => action.id !== primaryAction?.id,
  )
  const hasMenuActions = secondaryActions.length > 0 || Boolean(deletionAction)

  if ((!renderPrimary || !primaryAction) && (!renderMenu || !hasMenuActions)) {
    return null
  }

  return (
    <>
      {renderPrimary && primaryAction
        ? renderDocumentSummaryActionButton(primaryAction)
        : null}
      {renderMenu && hasMenuActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="More document actions"
                className="shrink-0"
              />
            }
          >
            <IconDotsVertical key="icon" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {secondaryActions.length > 0 ? (
              <DropdownMenuGroup>
                {secondaryActions.map((action) =>
                  renderDocumentSummaryMenuItem(action),
                )}
              </DropdownMenuGroup>
            ) : null}
            {secondaryActions.length > 0 && deletionAction ? (
              <DropdownMenuSeparator />
            ) : null}
            {deletionAction ? (
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={deletionAction.disabled}
                  className="items-start"
                  onClick={deletionAction.onSelect}
                >
                  <IconTrash />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>{deletionAction.label}</span>
                    {deletionAction.disabledReason ? (
                      <span className="whitespace-normal text-xs text-muted-foreground">
                        {deletionAction.disabledReason}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  )
}

function renderDocumentSummaryActionButton(action: DocumentSummaryAction) {
  const className = 'w-full sm:w-auto'

  switch (action.kind) {
    case 'signed-workspace':
      return (
        <Link
          key={action.id}
          to="/upload/batches/$batchId/sign"
          params={{ batchId: action.batchId }}
          search={defaultBatchDetailSearch}
          className={buttonVariants({ size: 'sm', className })}
        >
          <IconFileDescription key="icon" data-icon="inline-start" />
          <span key="label">{action.label}</span>
        </Link>
      )
    case 'review-issue':
      return (
        <Link
          key={action.id}
          to="/error-detail"
          search={{ docId: action.documentId, errorIndex: action.errorIndex }}
          className={buttonVariants({ size: 'sm', className })}
        >
          <IconShieldExclamation key="icon" data-icon="inline-start" />
          <span key="label">{action.label}</span>
        </Link>
      )
    case 'download-signed-pdf':
      return (
        <a
          key={action.id}
          href={action.href}
          className={buttonVariants({ size: 'sm', className })}
        >
          <IconDownload key="icon" data-icon="inline-start" />
          <span key="label">{action.label}</span>
        </a>
      )
  }
}

function renderDocumentSummaryMenuItem(action: DocumentSummaryAction) {
  switch (action.kind) {
    case 'signed-workspace':
      return (
        <DropdownMenuItem
          key={action.id}
          render={
            <Link
              to="/upload/batches/$batchId/sign"
              params={{ batchId: action.batchId }}
              search={defaultBatchDetailSearch}
            />
          }
        >
          <IconFileDescription key="icon" />
          <span key="label">{action.label}</span>
        </DropdownMenuItem>
      )
    case 'review-issue':
      return (
        <DropdownMenuItem
          key={action.id}
          render={
            <Link
              to="/error-detail"
              search={{
                docId: action.documentId,
                errorIndex: action.errorIndex,
              }}
            />
          }
        >
          <IconShieldExclamation key="icon" />
          <span key="label">{action.label}</span>
        </DropdownMenuItem>
      )
    case 'download-signed-pdf':
      return (
        <DropdownMenuItem key={action.id} render={<a href={action.href} />}>
          <IconDownload key="icon" />
          <span key="label">{action.label}</span>
        </DropdownMenuItem>
      )
  }
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

function buildAssignmentYearOptions(sourceYear: number) {
  const currentYear = new Date().getFullYear()
  const years = new Set([
    sourceYear,
    sourceYear + 1,
    sourceYear + 2,
    currentYear,
    currentYear + 1,
  ])

  return Array.from(years)
    .filter((year) => year >= 2000 && year <= 2100)
    .sort((left, right) => left - right)
}

function getAssignmentReasonLabel(reason: string) {
  switch (reason) {
    case 'late_after_finalized_annual':
      return 'Late after finalized annual package'
    case 'annual_package_unavailable':
      return 'Annual package unavailable'
    case 'late_after_finalized_quarter':
      return 'Late after finalized quarter'
    case 'quarterly_package_unavailable':
      return 'Quarterly package unavailable'
    case 'manual_review':
      return 'Manual review'
    case 'manual_override':
      return 'Manual override'
    case 'natural_period':
      return 'Natural period'
    default:
      return reason.replace(/_/g, ' ')
  }
}

function ManualReviewMergeAssignmentsCard({
  document,
  canManageMergeAssignments,
  onAssignmentUpdated,
}: {
  document: OperationalDocumentView
  canManageMergeAssignments: boolean
  onAssignmentUpdated?: () => void | Promise<void>
}) {
  const manualReviewAssignments =
    document.kind === 'certificate'
      ? (document.mergeAssignments ?? []).filter(
          (assignment) => assignment.status === 'manual_review',
        )
      : []

  if (manualReviewAssignments.length === 0) return null

  return (
    <DetailCard
      title="Merge assignment review"
      description="Assign manual-review certificates into an open package."
      icon={<IconListDetails className="size-4" />}
    >
      <div className="flex flex-col gap-3">
        {canManageMergeAssignments ? null : (
          <p
            className={cn(
              'rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground',
              PANEL_BORDER_CLASS,
            )}
          >
            PDF export access is required to update merge assignments.
          </p>
        )}
        {manualReviewAssignments.map((assignment) => (
          <MergeAssignmentOverrideForm
            key={`${assignment.packageType}-${assignment.sourcePeriod}`}
            certificateId={document.certificateId}
            assignment={assignment}
            disabled={!canManageMergeAssignments}
            onAssignmentUpdated={onAssignmentUpdated}
          />
        ))}
      </div>
    </DetailCard>
  )
}

function MergeAssignmentOverrideForm({
  certificateId,
  assignment,
  disabled,
  onAssignmentUpdated,
}: {
  certificateId?: number
  assignment: DocumentMergeAssignmentView
  disabled: boolean
  onAssignmentUpdated?: () => void | Promise<void>
}) {
  const isQuarterly = assignment.packageType === 'quarterly'
  const yearOptions = buildAssignmentYearOptions(assignment.sourceYear)
  const defaultAssignedYear = String(
    assignment.assignedYear ?? assignment.sourceYear,
  )
  const defaultAssignedQuarter = String(
    assignment.assignedQuarter ?? assignment.sourceQuarter ?? 1,
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled) return

    if (certificateId === undefined) {
      toast.error('Validated certificate id is missing.')
      return
    }

    const form = event.currentTarget
    const submitButton = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )
    const formData = new FormData(form)
    const parsedYear = Number.parseInt(
      String(formData.get('assignedYear') ?? ''),
      10,
    )
    const parsedQuarter = Number.parseInt(
      String(formData.get('assignedQuarter') ?? ''),
      10,
    )

    if (!Number.isInteger(parsedYear)) {
      toast.error('Select an assigned year.')
      return
    }

    if (isQuarterly && ![1, 2, 3, 4].includes(parsedQuarter)) {
      toast.error('Select an assigned quarter.')
      return
    }

    if (submitButton) {
      submitButton.disabled = true
    }

    try {
      const response = await fetch(
        `/api/certificates/${encodeURIComponent(
          String(certificateId),
        )}/merge-assignment`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            packageType: assignment.packageType,
            status: 'assigned',
            assignedYear: parsedYear,
            ...(isQuarterly ? { assignedQuarter: parsedQuarter } : {}),
          }),
        },
      )
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to update merge assignment (${response.status}).`,
        )
      }

      toast.success('Merge assignment updated.')
      await onAssignmentUpdated?.()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to update merge assignment.'
      toast.error(message)
    } finally {
      if (submitButton) {
        submitButton.disabled = false
      }
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className={cn('rounded-lg border bg-background p-3', PANEL_BORDER_CLASS)}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">
                {assignment.packageType === 'annual' ? 'Annual' : 'Quarterly'}{' '}
                package
              </p>
              <Badge variant="outline">Manual review</Badge>
              {assignment.isLate ? (
                <Badge variant="secondary">Late</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {assignment.sourcePeriod} certificate needs an assigned package.
              Reason: {getAssignmentReasonLabel(assignment.reason)}.
            </p>
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={disabled}>
            <IconCheck key="icon" data-icon="inline-start" />
            <span key="label">Assign package</span>
          </Button>
        </div>

        <FieldGroup className="gap-3 md:grid md:grid-cols-2">
          <Field data-disabled={disabled ? true : undefined}>
            <FieldLabel>Assigned year</FieldLabel>
            <select
              name="assignedYear"
              defaultValue={defaultAssignedYear}
              disabled={disabled}
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {yearOptions.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
            <FieldDescription>
              Target package year must still be open.
            </FieldDescription>
          </Field>

          {isQuarterly ? (
            <Field data-disabled={disabled ? true : undefined}>
              <FieldLabel>Assigned quarter</FieldLabel>
              <select
                name="assignedQuarter"
                defaultValue={defaultAssignedQuarter}
                disabled={disabled}
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {[1, 2, 3, 4].map((quarter) => (
                  <option key={quarter} value={String(quarter)}>
                    Q{quarter}
                  </option>
                ))}
              </select>
              <FieldDescription>
                Active or completed quarters are rejected.
              </FieldDescription>
            </Field>
          ) : null}
        </FieldGroup>
      </div>
    </form>
  )
}

export function ExtractedFieldsCard({
  document,
}: {
  document: OperationalDocumentView
}) {
  return (
    <DetailCard
      title="Extracted fields"
      description="Normalized values and confidence from document processing."
      icon={<IconListCheck className="size-4" />}
    >
      {document.reviewFields.length > 0 ? (
        <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {document.reviewFields.map((field) => (
            <div
              key={field.label}
              className={cn(
                'rounded-lg border bg-background px-3 py-2.5',
                PANEL_BORDER_CLASS,
              )}
            >
              <dt className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                <span>{field.label}</span>
                {field.source === 'edited' ? (
                  <Badge variant="secondary">Edited</Badge>
                ) : null}
              </dt>
              <dd className="mt-1 break-words text-sm font-semibold text-foreground">
                {field.value || '—'}
              </dd>
              {field.source === 'edited' && field.originalValue ? (
                <dd className="mt-1 text-xs text-muted-foreground">
                  Original: {field.originalValue}
                </dd>
              ) : null}
              <dd className="mt-2">
                <Badge
                  variant="outline"
                  className="h-5 rounded-md px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Confidence {field.confidence}
                </Badge>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="rounded-lg border border-border/70 bg-background px-3 py-2.5 text-xs text-muted-foreground">
          No extracted field data available.
        </p>
      )}
    </DetailCard>
  )
}

export function TaxRowsCard({
  document,
}: {
  document: OperationalDocumentView
}) {
  return (
    <DetailCard
      title="ATC details"
      description="Tax rows in certificate page and line order."
      icon={<IconListDetails className="size-4" />}
    >
      {document.taxRows.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ATC</TableHead>
                <TableHead className="text-right">Tax base</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Tax withheld</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {document.taxRows.map((row) => (
                <TableRow
                  key={`${row.pageNumber}:${row.lineNumber}`}
                  data-testid="document-tax-row"
                >
                  <TableCell className="font-medium">
                    {row.atcCode || '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTaxRowAmount(row.taxBase)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTaxRowRate(row.taxRate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTaxRowAmount(row.taxWithheld)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="rounded-lg border border-border/70 bg-background px-3 py-2.5 text-xs text-muted-foreground">
          No ATC detail rows available.
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
            className="grid gap-2 border-b border-border/60 px-3 py-2 last:border-b-0 md:grid-cols-[minmax(0,0.9fr)_11rem_minmax(0,1.2fr)_auto] md:items-start"
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
            className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
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
  canRequestOverride = false,
  onOverrideRequested,
  isRetryingExtraction = false,
  onRetryExtraction,
}: {
  document: OperationalDocumentView
  canRequestOverride?: boolean
  onOverrideRequested?: () => void | Promise<void>
  isRetryingExtraction?: boolean
  onRetryExtraction?: () => void
}) {
  const hasErrors = document.errors.length > 0

  return (
    <DetailCard
      title="Errors"
      description="Validation failures or duplicate reasons."
      tone="secondary"
      icon={<IconShieldExclamation className="size-4" />}
    >
      <div className="flex flex-col gap-3">
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

        {document.extractionRetry ? (
          <ExtractionRetryAction
            retry={document.extractionRetry}
            isRetrying={isRetryingExtraction}
            onRetry={onRetryExtraction}
          />
        ) : null}

        <OverrideRequestAction
          document={document}
          canRequestOverride={canRequestOverride}
          onOverrideRequested={onOverrideRequested}
        />
      </div>
    </DetailCard>
  )
}

function OverrideRequestAction({
  document,
  canRequestOverride,
  onOverrideRequested,
}: {
  document: OperationalDocumentView
  canRequestOverride: boolean
  onOverrideRequested?: () => void | Promise<void>
}) {
  const override = document.override ?? null
  const canSubmit =
    canRequestOverride &&
    document.canRequestOverride === true &&
    document.certificateId !== undefined

  if (!override && !canSubmit) {
    return null
  }

  const correctionFields = document.reviewFields.flatMap((field) => {
    const fieldPathByKey: Record<string, string> = {
      periodStart: 'period.start',
      periodEnd: 'period.end',
      monthOfQuarter: 'period.monthOfQuarter',
      payeeName: 'payee.name',
      payeeTin: 'payee.tin',
      payorName: 'payor.name',
      payorTin: 'payor.tin',
      atcCode: 'primaryAtcCode',
      taxBase: 'totals.taxBase',
      taxWithheld: 'totals.taxWithheld',
      printedName: 'signer.printedName',
      signatoryTitle: 'signer.title',
      signatoryTin: 'signer.tin',
      signaturePresent: 'signer.signature.present',
      companyName: 'signer.companyName',
    }
    const fieldPath = field.key ? fieldPathByKey[field.key] : undefined
    return fieldPath
      ? [{ fieldPath, label: field.label, currentValue: field.rawValue }]
      : []
  })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return

    const form = event.currentTarget
    const submitButton = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )
    const formData = new FormData(form)
    const requestNote = String(formData.get('requestNote') ?? '').trim()
    const fieldPath = String(formData.get('fieldPath') ?? '').trim()
    const proposedText = String(formData.get('proposedValue') ?? '').trim()

    if (!requestNote) {
      toast.error('Request note is required.')
      return
    }
    if (!fieldPath || !proposedText) {
      toast.error('Select a field and enter its corrected value.')
      return
    }

    let proposedValue: string | boolean = proposedText
    if (fieldPath === 'signer.signature.present') {
      const normalized = proposedText.toLowerCase()
      if (['true', 'yes', 'present', 'signed', '1'].includes(normalized)) {
        proposedValue = true
      } else if (
        ['false', 'no', 'absent', 'missing', '0'].includes(normalized)
      ) {
        proposedValue = false
      } else {
        toast.error('Signature present must be yes or no.')
        return
      }
    }

    if (submitButton) {
      submitButton.disabled = true
    }

    try {
      const response = await fetch('/api/certificate-overrides', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          certificateId: document.certificateId,
          changes: [{ fieldPath, proposedValue }],
          requestNote,
        }),
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to request override (${response.status}).`,
        )
      }

      toast.success('Override request submitted.')
      form.reset()
      await onOverrideRequested?.()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to request certificate override.'
      toast.error(message)
    } finally {
      if (submitButton) {
        submitButton.disabled = false
      }
    }
  }

  const statusLabel = override
    ? override.status === 'approved'
      ? 'Approved'
      : override.status === 'rejected'
        ? 'Rejected'
        : 'Pending'
    : 'Not requested'
  const triggerLabel = canSubmit ? 'Request override' : 'View override'
  const badgeVariant =
    override?.status === 'approved'
      ? 'secondary'
      : override?.status === 'rejected'
        ? 'destructive'
        : 'outline'

  return (
    <div className="flex flex-col gap-3">
      <Separator />
      <Sheet>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-xs font-medium text-foreground">
              Override request
            </p>
            {override ? (
              <Badge variant={badgeVariant}>{statusLabel}</Badge>
            ) : null}
          </div>
          <SheetTrigger
            render={
              <Button
                type="button"
                size="sm"
                variant={canSubmit ? 'default' : 'outline'}
                className="shrink-0"
              />
            }
          >
            <IconShieldExclamation data-icon="inline-start" />
            {triggerLabel}
          </SheetTrigger>
        </div>

        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader className="border-b border-border/60 p-4">
            <SheetTitle>Override request</SheetTitle>
            <SheetDescription>
              Governed exception review for validation failures.
            </SheetDescription>
          </SheetHeader>

          {canSubmit ? (
            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {override ? (
                  <OverrideRequestDetails override={override} />
                ) : null}

                <FieldGroup className="gap-3">
                  <Field>
                    <FieldLabel htmlFor="certificate-override-field">
                      Field to correct
                    </FieldLabel>
                    <select
                      id="certificate-override-field"
                      name="fieldPath"
                      required
                      defaultValue=""
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <option value="" disabled>
                        Select an extracted field
                      </option>
                      {correctionFields.map((field) => (
                        <option key={field.fieldPath} value={field.fieldPath}>
                          {field.label} — {String(field.currentValue ?? '—')}
                        </option>
                      ))}
                    </select>
                    <FieldDescription>
                      The current extracted value remains immutable; approval
                      updates the effective certificate projection.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="certificate-override-proposed-value">
                      Corrected value
                    </FieldLabel>
                    <Input
                      id="certificate-override-proposed-value"
                      name="proposedValue"
                      maxLength={800}
                      required
                    />
                    <FieldDescription>
                      Use YYYY-MM-DD for dates, decimal strings for amounts, and
                      yes or no for signature presence.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="certificate-override-request-note">
                      Request note
                    </FieldLabel>
                    <Textarea
                      id="certificate-override-request-note"
                      name="requestNote"
                      maxLength={1200}
                      required
                      className="min-h-28 rounded-md bg-background"
                    />
                    <FieldDescription>
                      Include the business reason for approving this
                      certificate.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </div>

              <SheetFooter className="shrink-0 border-t border-border/60 bg-background p-4">
                <div className="flex justify-end gap-2">
                  <SheetClose
                    render={
                      <Button type="button" variant="outline" size="sm" />
                    }
                  >
                    Cancel
                  </SheetClose>
                  <Button type="submit" size="sm">
                    <IconShieldExclamation data-icon="inline-start" />
                    Submit request
                  </Button>
                </div>
              </SheetFooter>
            </form>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {override ? (
                  <OverrideRequestDetails override={override} />
                ) : null}
              </div>

              <SheetFooter className="shrink-0 border-t border-border/60 bg-background p-4">
                <div className="flex justify-end">
                  <SheetClose
                    render={
                      <Button type="button" variant="outline" size="sm" />
                    }
                  >
                    Close
                  </SheetClose>
                </div>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function OverrideRequestDetails({
  override,
}: {
  override: NonNullable<OperationalDocumentView['override']>
}) {
  return (
    <dl
      className={cn(
        'mb-4 overflow-hidden rounded-lg border bg-background',
        PANEL_BORDER_CLASS,
      )}
    >
      <OverrideDetailRow label="Status">
        <Badge
          variant={override.status === 'approved' ? 'secondary' : 'outline'}
        >
          {override.status === 'approved'
            ? 'Approved'
            : override.status === 'rejected'
              ? 'Rejected'
              : 'Pending'}
        </Badge>
      </OverrideDetailRow>
      <OverrideDetailRow label="Requested by">
        {override.requestedByName}
      </OverrideDetailRow>
      <OverrideDetailRow label="Requested at">
        {override.requestedAt}
      </OverrideDetailRow>
      <OverrideDetailRow label="Request note">
        {override.requestNote}
      </OverrideDetailRow>
      {override.decidedByName ? (
        <OverrideDetailRow label="Decided by">
          {override.decidedByName}
        </OverrideDetailRow>
      ) : null}
      {override.decidedAt ? (
        <OverrideDetailRow label="Decided at">
          {override.decidedAt}
        </OverrideDetailRow>
      ) : null}
      {override.decisionNote ? (
        <OverrideDetailRow label="Decision note">
          {override.decisionNote}
        </OverrideDetailRow>
      ) : null}
    </dl>
  )
}

function OverrideDetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1 border-b border-border/60 px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
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
    <div className="grid gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-b-0 md:grid-cols-[9.5rem_auto_minmax(0,1fr)] md:items-start">
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
