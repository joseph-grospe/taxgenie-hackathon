import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconCheck,
  IconChecks,
  IconCloudUpload,
  IconFileAnalytics,
  IconFileTypePdf,
  IconListDetails,
  IconLoader2,
  IconMinus,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconStack2,
  IconTimeline,
  IconUpload,
} from '@tabler/icons-react'
import { useDeferredValue, useMemo, useState } from 'react'
import type { ChangeEvent, ReactNode, RefObject } from 'react'

import type {
  IntakeUploadView,
  LocalUploadItem,
  StatusSummary,
} from '@/lib/upload-intake-types'
import type {
  CurrentUploadActionId,
  JobsStatusFilter,
  JobsTab,
  WorkflowStage,
  WorkflowStageStatus,
} from '@/lib/upload-intake-view-model'
import {
  buildCurrentUploadCardModel,
  buildJobsModel,
  buildNeedsAttentionItems,
  buildQueueMetrics,
} from '@/lib/upload-intake-view-model'
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
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

type UploadIntakePageProps = {
  inputRef: RefObject<HTMLInputElement | null>
  localUpload: LocalUploadItem | null
  recentUploads: Array<IntakeUploadView>
  summary: StatusSummary
  isRefreshing: boolean
  loadError: string | null
  resolvingAttentionIds: Array<string>
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void
  onSelectFile: () => void
  onStartUpload: () => void
  onOpenDestination: (documentId: string | null | undefined) => void
  onRefresh: () => void
  onResolveAttention: (uploadId: string) => void
}

const STATUS_FILTER_OPTIONS: Array<{
  value: JobsStatusFilter
  label: string
}> = [
  { value: 'all', label: 'All statuses' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'failed', label: 'Failed' },
]

const formatBytes = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return '—'
  }

  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function UploadIntakePage({
  inputRef,
  localUpload,
  recentUploads,
  summary,
  isRefreshing,
  loadError,
  resolvingAttentionIds,
  onFilesSelected,
  onSelectFile,
  onStartUpload,
  onOpenDestination,
  onRefresh,
  onResolveAttention,
}: UploadIntakePageProps) {
  const [jobsTab, setJobsTab] = useState<JobsTab>('all')
  const [jobsSearch, setJobsSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<JobsStatusFilter>('all')
  const deferredSearch = useDeferredValue(jobsSearch)

  const currentUpload = useMemo(
    () => buildCurrentUploadCardModel({ localUpload, recentUploads }),
    [localUpload, recentUploads],
  )
  const queueMetrics = useMemo(
    () => buildQueueMetrics(summary, recentUploads),
    [recentUploads, summary],
  )
  const needsAttentionItems = useMemo(
    () => buildNeedsAttentionItems(recentUploads),
    [recentUploads],
  )
  const jobsModel = useMemo(
    () =>
      buildJobsModel({
        uploads: recentUploads,
        activeTab: jobsTab,
        statusFilter,
        searchQuery: deferredSearch,
      }),
    [deferredSearch, jobsTab, recentUploads, statusFilter],
  )

  const handleCurrentUploadAction = (actionId: CurrentUploadActionId) => {
    switch (actionId) {
      case 'start_upload':
      case 'retry':
        onStartUpload()
        return
      case 'select_file':
        onSelectFile()
        return
      case 'open_results':
      case 'review_issue':
      case 'view_details':
        onOpenDestination(currentUpload.uploadId)
        return
      default:
        return
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={onFilesSelected}
      />

      {loadError ? (
        <div
          role="alert"
          className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {loadError}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.85fr)_minmax(18rem,0.9fr)]">
        <CurrentUploadCard
          model={currentUpload}
          onAction={handleCurrentUploadAction}
        />
        <UploadRulesCard />
      </div>

      <QueueStrip metrics={queueMetrics} />

      <NeedsAttentionPanel
        items={needsAttentionItems}
        onOpenDestination={onOpenDestination}
        onResolveAttention={onResolveAttention}
        resolvingIds={resolvingAttentionIds}
      />

      <JobsTable
        jobsTab={jobsTab}
        jobsSearch={jobsSearch}
        jobsModel={jobsModel}
        isRefreshing={isRefreshing}
        statusFilter={statusFilter}
        onJobsSearchChange={setJobsSearch}
        onJobsTabChange={setJobsTab}
        onOpenDestination={onOpenDestination}
        onRefresh={onRefresh}
        onStatusFilterChange={setStatusFilter}
      />
    </div>
  )
}

function CurrentUploadCard({
  model,
  onAction,
}: {
  model: ReturnType<typeof buildCurrentUploadCardModel>
  onAction: (actionId: CurrentUploadActionId) => void
}) {
  const showEmptyState = model.state === 'empty'
  const statusPill =
    model.state === 'uploading' || model.state === 'processing'
      ? 'Processing'
      : model.statusLabel

  return (
    <Card className="border-border/90 bg-card shadow-sm shadow-black/3">
      <CardHeader className="gap-3 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Badge
              variant="outline"
              className="h-6 rounded-full border-primary/20 bg-primary/5 px-2 text-primary"
            >
              Primary workspace
            </Badge>
            <div className="flex flex-col gap-1">
              <CardTitle className="text-xl font-semibold tracking-tight">
                {model.title}
              </CardTitle>
              <CardDescription className="max-w-2xl leading-6">
                Upload a PDF containing one or more BIR 2307 certificates. We
                detect certificate pages, ignore non-2307 pages, and save
                results only after full validation.
              </CardDescription>
            </div>
          </div>
          {!showEmptyState ? <StatusPill status={statusPill} /> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-5">
        {showEmptyState ? (
          <div className="flex min-h-72 flex-col justify-between gap-6 rounded-[1.5rem] border border-dashed border-border bg-muted/[0.16] px-6 py-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex max-w-xl items-start gap-4">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-background shadow-sm shadow-black/3">
                  <IconFileTypePdf />
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-lg font-semibold tracking-tight">
                    Upload a BIR 2307 PDF
                  </p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Start a new intake run with one PDF that may contain one or
                    more certificates. The upload card becomes your live job
                    surface once the file is selected.
                  </p>
                </div>
              </div>
              <div className="grid gap-2 lg:min-w-64">
                <EmptyStateSupport
                  icon={<IconFileTypePdf />}
                  title="One upload per run"
                  detail="Keep each intake workflow scoped to a single PDF."
                />
                <EmptyStateSupport
                  icon={<IconSearch />}
                  title="Automatic page detection"
                  detail="We find certificate pages without manual splitting."
                />
                <EmptyStateSupport
                  icon={<IconShieldCheck />}
                  title="Saved only after validation"
                  detail="Results are persisted only when the workflow completes cleanly."
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-background/90 px-4 py-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  Ready to start intake
                </p>
                <p className="text-sm text-muted-foreground">
                  Select a PDF to begin the upload and processing workflow.
                </p>
              </div>
              <Button
                type="button"
                size="lg"
                onClick={() => onAction('select_file')}
              >
                <IconUpload data-icon="inline-start" />
                Upload PDF
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-[1.5rem] border border-border/90 bg-muted/[0.16] p-4 shadow-inner shadow-black/[0.02]">
              <div className="flex flex-col gap-4 rounded-[1.25rem] border border-border/80 bg-background/90 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-background shadow-sm shadow-black/3">
                      <IconFileTypePdf />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <p className="text-sm font-medium text-muted-foreground">
                        {model.helperText}
                      </p>
                      <p className="truncate text-lg font-semibold tracking-tight">
                        {model.fileName}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>{formatBytes(model.sizeBytes)}</span>
                        <span className="size-1 rounded-full bg-border" />
                        <span aria-live="polite">{model.detailText}</span>
                      </div>
                      {model.errorMessage ? (
                        <p className="text-sm text-destructive">
                          {model.errorMessage}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                {model.summaryChips.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {model.summaryChips.map((chip) => (
                      <SummaryChip key={chip.label} chip={chip} />
                    ))}
                  </div>
                ) : null}

                {model.summaryFallbackLabel ? (
                  <p className="text-xs text-muted-foreground">
                    {model.summaryFallbackLabel}
                  </p>
                ) : null}
              </div>

              <div className="mt-4">
                <UploadStageStepper stages={model.stages} />
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-muted/[0.12] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {model.actions.map((action) => (
                  <Button
                    key={action.id}
                    type="button"
                    variant={action.variant}
                    onClick={() => onAction(action.id)}
                    size="sm"
                  >
                    {getCurrentActionIcon(action.id)}
                    {action.label}
                  </Button>
                ))}
              </div>
              <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                {model.note}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function EmptyStateSupport({
  icon,
  title,
  detail,
}: {
  icon: ReactNode
  title: string
  detail: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border/80 bg-background/90 px-3 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/[0.18] text-muted-foreground">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function getCurrentActionIcon(actionId: CurrentUploadActionId) {
  switch (actionId) {
    case 'start_upload':
    case 'retry':
    case 'select_file':
      return <IconCloudUpload data-icon="inline-start" />
    case 'open_results':
    case 'review_issue':
    case 'view_details':
      return <IconArrowUpRight data-icon="inline-start" />
    default:
      return null
  }
}

function SummaryChip({
  chip,
}: {
  chip: ReturnType<typeof buildCurrentUploadCardModel>['summaryChips'][number]
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-9 gap-2 rounded-2xl border px-2.5',
        chip.tone === 'neutral' &&
          'border-border/80 bg-muted/30 text-foreground',
        chip.tone === 'success' &&
          'border-primary/25 bg-primary/8 text-primary',
        chip.tone === 'warning' &&
          'border-amber-500/25 bg-amber-500/8 text-amber-700',
      )}
    >
      <span className="rounded-full bg-background/85 px-1.5 py-0.5 font-semibold tabular-nums">
        {chip.value}
      </span>
      <span
        className={cn(
          'flex size-5 items-center justify-center rounded-full border border-current/15 bg-background/70',
          chip.tone === 'success' && 'text-primary',
          chip.tone === 'warning' && 'text-amber-700',
          chip.tone === 'neutral' && 'text-muted-foreground',
        )}
      >
        {getSummaryChipIcon(chip.label)}
      </span>
      <span className="leading-none">{chip.label}</span>
      {chip.placeholder ? (
        <span className="text-muted-foreground">(estimate)</span>
      ) : null}
    </Badge>
  )
}

function getSummaryChipIcon(label: string) {
  switch (label) {
    case 'certificates detected':
      return <IconFileAnalytics className="size-3.5" />
    case 'validated':
      return <IconChecks className="size-3.5" />
    case 'skipped':
      return <IconMinus className="size-3.5" />
    default:
      return <IconCheck className="size-3.5" />
  }
}

function UploadStageStepper({ stages }: { stages: Array<WorkflowStage> }) {
  return (
    <div className="pb-1">
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {stages.map((stage, index) => (
          <li key={stage.key} className="relative min-w-0 pt-9">
            {index < stages.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-3.5 left-8 right-[-0.35rem] hidden h-px xl:block',
                  stage.status === 'complete'
                    ? 'bg-primary/35'
                    : stage.status === 'error'
                      ? 'bg-destructive/25'
                      : 'bg-border',
                )}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-0 left-1.5 flex size-6.5 items-center justify-center rounded-full border text-[11px] font-semibold',
                getStageTone(stage.status),
              )}
            >
              {stage.status === 'complete' ? (
                <IconCheck className="size-3.5" />
              ) : stage.status === 'active' ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : stage.status === 'error' ? (
                <IconAlertTriangle className="size-3.5" />
              ) : (
                <span>{stage.label.slice(0, 1)}</span>
              )}
            </span>
            <div
              className={cn(
                'rounded-xl border px-3 py-2.5',
                stage.status === 'complete' &&
                  'border-primary/15 bg-primary/[0.045]',
                stage.status === 'active' &&
                  'border-amber-500/20 bg-amber-500/[0.06]',
                stage.status === 'error' &&
                  'border-destructive/20 bg-destructive/[0.05]',
                stage.status === 'pending' && 'border-border/80 bg-background',
              )}
            >
              <div className="flex flex-col gap-1">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Step {index + 1}
                </p>
                <p className="line-clamp-2 min-h-8 text-xs font-medium leading-4">
                  {stage.label}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {getStageStatusLabel(stage.status)}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function UploadRulesCard() {
  const [helpOpen, setHelpOpen] = useState(false)
  const rules = [
    {
      title: 'One PDF per upload',
      detail: 'Keep each intake run scoped to a single source document.',
      icon: <IconFileTypePdf />,
    },
    {
      title: 'Multi-certificate aware',
      detail: 'A single PDF can contain multiple BIR 2307 certificate pages.',
      icon: <IconStack2 />,
    },
    {
      title: 'Non-2307 pages ignored',
      detail: 'Only detected certificate pages move through the workflow.',
      icon: <IconSearch />,
    },
    {
      title: 'Results saved after validation',
      detail: 'Nothing is persisted until the full upload passes validation.',
      icon: <IconShieldCheck />,
    },
  ]

  return (
    <Card
      id="upload-rules"
      className="border-border/80 bg-muted/[0.12] shadow-sm shadow-black/3"
    >
      <CardHeader className="gap-3">
        <Badge
          variant="outline"
          className="h-6 rounded-full border-border/80 bg-background px-2 text-muted-foreground"
        >
          Guardrails
        </Badge>
        <CardTitle className="text-lg font-semibold tracking-tight">
          Upload rules
        </CardTitle>
        <CardDescription className="leading-6">
          Keep uploads consistent so the intake flow stays predictable.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rules.map((rule) => (
          <div
            key={rule.title}
            className="flex items-start gap-3 rounded-2xl border border-border/80 bg-background px-3 py-3"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/5 text-primary">
              {rule.icon}
            </span>
            <div>
              <p className="text-sm font-medium">{rule.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {rule.detail}
              </p>
            </div>
          </div>
        ))}
        <div className="flex items-start gap-3 rounded-2xl border border-primary/15 bg-primary/[0.05] px-3 py-3 text-sm text-muted-foreground">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background text-primary">
            <IconShieldCheck />
          </div>
          <div className="leading-6">
            Need help?{' '}
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Review intake rules
            </button>
          </div>
        </div>
      </CardContent>

      <Sheet open={helpOpen} onOpenChange={setHelpOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Upload intake rules</SheetTitle>
            <SheetDescription>
              Keep each intake run predictable so certificate detection and
              validation stay reliable.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 px-6 pb-6">
            <div className="grid gap-3">
              {rules.map((rule) => (
                <div
                  key={`sheet-${rule.title}`}
                  className="rounded-2xl border border-border/80 bg-muted/[0.12] px-4 py-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/5 text-primary">
                      {rule.icon}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{rule.title}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {rule.detail}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-border/80 bg-background px-4 py-4">
              <p className="text-sm font-medium">Before you upload</p>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>Use a single PDF source document for each intake run.</li>
                <li>
                  Keep all BIR 2307 pages in the same file when they belong
                  together.
                </li>
                <li>
                  Do not split out non-2307 pages manually unless the source
                  file is incorrect.
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-border/80 bg-background px-4 py-4">
              <p className="text-sm font-medium">If the upload needs review</p>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>
                  Open the job details to review failed or duplicate pages.
                </li>
                <li>
                  Use Mark resolved only when you want it cleared from the Needs
                  Attention list.
                </li>
                <li>
                  Re-upload only when the source PDF itself is wrong or
                  incomplete.
                </li>
              </ul>
            </div>
          </div>

          <SheetFooter>
            <SheetClose render={<Button variant="outline" />}>Close</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  )
}

function QueueStrip({
  metrics,
}: {
  metrics: ReturnType<typeof buildQueueMetrics>
}) {
  return (
    <Card size="sm" className="border-border/80 bg-muted/[0.1]">
      <CardContent className="grid gap-4 md:grid-cols-[minmax(14rem,1.2fr)_repeat(4,minmax(0,1fr))] md:items-center">
        <div className="pr-2">
          <p className="text-sm font-medium">Live queue</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Current operational load across recent uploads.
          </p>
        </div>
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-2xl border border-border/80 bg-background/80 px-3 py-3 md:rounded-none md:border-0 md:border-l md:bg-transparent md:pl-4"
          >
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full border border-border/80 bg-background text-muted-foreground">
                {getQueueMetricIcon(metric.label)}
              </span>
              <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                {metric.label}
              </p>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
              {metric.value}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function getQueueMetricIcon(label: string) {
  switch (label) {
    case 'Waiting':
      return <IconTimeline className="size-4" />
    case 'Processing':
      return <IconLoader2 className="size-4" />
    case 'Needs attention':
      return <IconAlertTriangle className="size-4" />
    case 'Completed today':
      return <IconChecks className="size-4" />
    default:
      return <IconCheck className="size-4" />
  }
}

function NeedsAttentionPanel({
  items,
  onOpenDestination,
  onResolveAttention,
  resolvingIds,
}: {
  items: ReturnType<typeof buildNeedsAttentionItems>
  onOpenDestination: (documentId: string | null | undefined) => void
  onResolveAttention: (uploadId: string) => void
  resolvingIds: Array<string>
}) {
  return (
    <Card className="border-border/80 bg-muted/[0.1]">
      <CardHeader className="gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-full border border-border/80 bg-background text-muted-foreground">
            <IconListDetails />
          </div>
          <CardTitle className="text-lg font-semibold tracking-tight">
            Needs attention
          </CardTitle>
        </div>
        <CardDescription className="leading-6">
          Inline review space for failed validations, duplicates, and other
          follow-up cases.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-border/80 bg-background px-4 py-4 text-sm text-muted-foreground">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/30">
              <IconCheck />
            </div>
            <div>
              <p className="font-medium text-foreground">
                No uploads currently need review.
              </p>
              <p className="mt-1">
                Failed validations, duplicate uploads, and partial review cases
                will surface here.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-2xl border border-amber-500/20 bg-background px-4 py-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{item.fileName}</p>
                    <StatusPill status={item.statusLabel} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.message}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenDestination(item.id)}
                  >
                    <IconArrowUpRight data-icon="inline-start" />
                    {item.actionLabel}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onResolveAttention(item.id)}
                    disabled={resolvingIds.includes(item.id)}
                  >
                    <IconCheck data-icon="inline-start" />
                    Mark resolved
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function JobsTable({
  jobsTab,
  jobsSearch,
  jobsModel,
  isRefreshing,
  statusFilter,
  onJobsSearchChange,
  onJobsTabChange,
  onOpenDestination,
  onRefresh,
  onStatusFilterChange,
}: {
  jobsTab: JobsTab
  jobsSearch: string
  jobsModel: ReturnType<typeof buildJobsModel>
  isRefreshing: boolean
  statusFilter: JobsStatusFilter
  onJobsSearchChange: (value: string) => void
  onJobsTabChange: (value: JobsTab) => void
  onOpenDestination: (documentId: string | null | undefined) => void
  onRefresh: () => void
  onStatusFilterChange: (value: JobsStatusFilter) => void
}) {
  return (
    <Card className="border-border/90 bg-card shadow-sm shadow-black/3">
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-col gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg font-semibold tracking-tight">
                  Jobs
                </CardTitle>
                <Badge
                  variant="outline"
                  className="h-6 rounded-full border-border/80 bg-muted/20 px-2 text-muted-foreground"
                >
                  {jobsModel.counts.all} recent
                </Badge>
              </div>
              <CardDescription className="mt-1 leading-6">
                Recent upload runs with their current processing outcome and
                next action.
              </CardDescription>
            </div>
            <Tabs
              value={jobsTab}
              onValueChange={(value) => onJobsTabChange(value as JobsTab)}
            >
              <TabsList variant="line">
                <TabsTrigger value="all">
                  All ({jobsModel.counts.all})
                </TabsTrigger>
                <TabsTrigger value="processing">
                  Processing ({jobsModel.counts.processing})
                </TabsTrigger>
                <TabsTrigger value="completed">
                  Completed ({jobsModel.counts.completed})
                </TabsTrigger>
                <TabsTrigger value="needs_review">
                  Needs review ({jobsModel.counts.needs_review})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-border/80 bg-muted/[0.1] p-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 sm:w-72">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search filename"
                placeholder="Search filename"
                value={jobsSearch}
                onChange={(event) => onJobsSearchChange(event.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                onStatusFilterChange(value as JobsStatusFilter)
              }
            >
              <SelectTrigger
                aria-label="Status filter"
                className="w-full sm:w-[12.5rem]"
              >
                <SelectValue placeholder="Status filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <IconRefresh data-icon="inline-start" />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {jobsModel.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-border bg-muted/[0.18]">
              <IconSearch />
            </div>
            <div className="flex flex-col gap-1">
              <p className="font-medium text-foreground">
                No jobs match the current filters.
              </p>
              <p>Try a broader search or reset the status filter.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/80 bg-background">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/[0.18] hover:bg-muted/[0.18]">
                  <TableHead>File</TableHead>
                  <TableHead>Certificates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobsModel.rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/[0.16]">
                    <TableCell className="max-w-[22rem] whitespace-normal align-top">
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/[0.2]">
                          <IconFileTypePdf />
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="truncate font-medium">
                            {row.fileName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(row.sizeBytes)}
                          </span>
                          {row.issueSummary ? (
                            <span className="line-clamp-2 text-xs text-muted-foreground">
                              {row.issueSummary}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {row.certificatesLabel}
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusPill status={row.statusLabel} />
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {row.updatedAt}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          row.actionLabel === 'Review issue'
                            ? 'default'
                            : 'outline'
                        }
                        onClick={() => onOpenDestination(row.id)}
                      >
                        <IconArrowUpRight data-icon="inline-start" />
                        {row.actionLabel}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function getStageTone(status: WorkflowStageStatus) {
  switch (status) {
    case 'complete':
      return 'border-primary/30 bg-primary/10 text-primary'
    case 'active':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700'
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive'
    default:
      return 'border-border bg-muted/60 text-muted-foreground'
  }
}

function getStageStatusLabel(status: WorkflowStageStatus) {
  switch (status) {
    case 'complete':
      return 'Complete'
    case 'active':
      return 'In progress'
    case 'error':
      return 'Needs attention'
    default:
      return 'Pending'
  }
}
