import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconCheck,
  IconChecks,
  IconFilePlus,
  IconFileTypePdf,
  IconFolderOpen,
  IconListDetails,
  IconLoader2,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconStack2,
  IconTimeline,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import { useDeferredValue, useMemo, useState } from 'react'
import type { ChangeEvent, ReactNode, RefObject } from 'react'

import type {
  IntakeBatchView,
  IntakeUploadView,
  LocalUploadItem,
  StatusSummary,
} from '@/lib/upload-intake-types'
import type { JobsStatusFilter, JobsTab } from '@/lib/upload-intake-view-model'
import {
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
  activeBatch: IntakeBatchView | null
  recentBatches: Array<IntakeBatchView>
  uploads: Array<IntakeUploadView>
  localFiles: Array<LocalUploadItem>
  summary: StatusSummary
  isRefreshing: boolean
  isStartingUpload: boolean
  isClosingBatch: boolean
  loadError: string | null
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void
  onSelectFiles: () => void
  onStartUpload: () => void
  onCloseBatch: () => void
  onOpenDestination: (documentId: string | null | undefined) => void
  onOpenBatch: (batchId: string | null | undefined) => void
  onRefresh: () => void
}

type BatchFileRow = {
  id: string
  uploadId: string | null
  fileName: string
  sizeBytes: number
  statusLabel: string
  progress: number
  detail: string
  error: string | null
  isPendingSelection: boolean
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

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const formatBytes = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return '—'
  }

  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) {
    return '—'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return DATE_TIME_FORMATTER.format(parsed)
}

const getBatchDisplayName = (batch: IntakeBatchView) => batch.name ?? batch.id

const toProgressValue = (upload: IntakeUploadView) => {
  switch (upload.overallStatus) {
    case 'pending':
      return 0
    case 'uploaded':
      return 40
    case 'queued':
      return 70
    case 'processing':
      return 90
    default:
      return 100
  }
}

const toPendingCount = (localFiles: Array<LocalUploadItem>) =>
  localFiles.filter((file) => ['Pending', 'Error'].includes(file.status)).length

const buildBatchFileRows = (
  activeBatch: IntakeBatchView | null,
  localFiles: Array<LocalUploadItem>,
): Array<BatchFileRow> => {
  const serverRows =
    activeBatch?.files.map<BatchFileRow>((file) => ({
      id: file.id,
      uploadId: file.id,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes,
      statusLabel:
        file.overallStatus === 'success'
          ? 'Done'
          : file.overallStatus === 'duplicate'
            ? 'Duplicate'
            : file.overallStatus === 'error'
              ? 'Error'
              : file.overallStatus === 'processing'
                ? 'Processing'
                : file.overallStatus === 'queued'
                  ? 'Queued'
                  : file.overallStatus === 'uploaded'
                    ? 'Uploaded'
                    : 'Pending',
      progress: toProgressValue(file),
      detail: file.currentStep
        ? `Current step: ${file.currentStep.replace(/[_-]+/g, ' ')}`
        : file.errorMessage
          ? file.errorMessage
          : 'Persisted in the current upload batch.',
      error: file.errorMessage,
      isPendingSelection: false,
    })) ?? []

  const serverUploadIds = new Set(
    serverRows
      .map((row) => row.uploadId)
      .filter((uploadId): uploadId is string => Boolean(uploadId)),
  )

  const localRows = localFiles
    .filter((file) => !file.uploadId || !serverUploadIds.has(file.uploadId))
    .map<BatchFileRow>((file) => ({
      id: file.clientId,
      uploadId: file.uploadId,
      fileName: file.file.name,
      sizeBytes: file.file.size,
      statusLabel: file.status,
      progress:
        file.status === 'Pending'
          ? 0
          : file.status === 'Requesting'
            ? 10
            : file.progress,
      detail:
        file.status === 'Pending'
          ? 'Waiting to be uploaded into the current batch.'
          : file.status === 'Requesting'
            ? 'Preparing signed upload URL.'
            : file.status === 'Uploading'
              ? 'Uploading file directly to source storage.'
              : file.status === 'Queueing'
                ? 'Validating the uploaded object and queueing processing.'
                : file.status === 'Error'
                  ? 'Upload needs attention before it can continue.'
                  : 'Upload finished.',
      error: file.error,
      isPendingSelection: true,
    }))

  return [...localRows, ...serverRows]
}

export function UploadIntakePage({
  inputRef,
  activeBatch,
  recentBatches,
  uploads,
  localFiles,
  summary,
  isRefreshing,
  isStartingUpload,
  isClosingBatch,
  loadError,
  onFilesSelected,
  onSelectFiles,
  onStartUpload,
  onCloseBatch,
  onOpenDestination,
  onOpenBatch,
  onRefresh,
}: UploadIntakePageProps) {
  const [jobsTab, setJobsTab] = useState<JobsTab>('all')
  const [jobsSearch, setJobsSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<JobsStatusFilter>('all')
  const deferredSearch = useDeferredValue(jobsSearch)

  const queueMetrics = useMemo(
    () => buildQueueMetrics(summary, uploads),
    [summary, uploads],
  )
  const needsAttentionItems = useMemo(
    () => buildNeedsAttentionItems(uploads),
    [uploads],
  )
  const jobsModel = useMemo(
    () =>
      buildJobsModel({
        uploads,
        activeTab: jobsTab,
        statusFilter,
        searchQuery: deferredSearch,
      }),
    [deferredSearch, jobsTab, uploads, statusFilter],
  )
  const batchRows = useMemo(
    () => buildBatchFileRows(activeBatch, localFiles),
    [activeBatch, localFiles],
  )
  const pendingSelections = toPendingCount(localFiles)
  const hasBlockingLocalWork = localFiles.some((file) =>
    ['Pending', 'Requesting', 'Uploading', 'Queueing'].includes(file.status),
  )

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
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
        <ActiveBatchCard
          activeBatch={activeBatch}
          hasBlockingLocalWork={hasBlockingLocalWork}
          isStartingUpload={isStartingUpload}
          isClosingBatch={isClosingBatch}
          pendingSelections={pendingSelections}
          rows={batchRows}
          onCloseBatch={onCloseBatch}
          onOpenDestination={onOpenDestination}
          onOpenBatch={onOpenBatch}
          onSelectFiles={onSelectFiles}
          onStartUpload={onStartUpload}
        />
        <UploadRulesCard />
      </div>

      <RecentBatchesCard
        activeBatch={activeBatch}
        recentBatches={recentBatches}
        onOpenBatch={onOpenBatch}
      />

      <QueueStrip metrics={queueMetrics} />

      <NeedsAttentionPanel
        items={needsAttentionItems}
        onOpenDestination={onOpenDestination}
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

      {activeBatch ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Active batch `{activeBatch.id}` stays open until you close it. Files
          upload and process independently, so one failed upload will not block
          the rest of the batch.
        </p>
      ) : hasBlockingLocalWork ? (
        <p className="text-xs leading-5 text-muted-foreground">
          The batch will be created automatically when you start uploading the
          selected files.
        </p>
      ) : null}
    </div>
  )
}

function ActiveBatchCard({
  activeBatch,
  hasBlockingLocalWork,
  rows,
  pendingSelections,
  isStartingUpload,
  isClosingBatch,
  onSelectFiles,
  onStartUpload,
  onCloseBatch,
  onOpenDestination,
  onOpenBatch,
}: {
  activeBatch: IntakeBatchView | null
  hasBlockingLocalWork: boolean
  rows: Array<BatchFileRow>
  pendingSelections: number
  isStartingUpload: boolean
  isClosingBatch: boolean
  onSelectFiles: () => void
  onStartUpload: () => void
  onCloseBatch: () => void
  onOpenDestination: (documentId: string | null | undefined) => void
  onOpenBatch: (batchId: string | null | undefined) => void
}) {
  const showEmptyState = !activeBatch && rows.length === 0
  const canStartUpload = pendingSelections > 0

  return (
    <Card className="border-border/90 bg-card shadow-sm shadow-black/3">
      <CardHeader className="gap-3 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Badge
              variant="outline"
              className="h-6 rounded-full border-primary/20 bg-primary/5 px-2 text-primary"
            >
              Batch-based intake
            </Badge>
            <div className="flex flex-col gap-1">
              <CardTitle className="text-xl font-semibold tracking-tight">
                {showEmptyState
                  ? 'Open an upload batch'
                  : 'Active upload batch'}
              </CardTitle>
              <CardDescription className="max-w-2xl leading-6">
                Upload multiple BIR 2307 PDFs into one batch, monitor each
                file independently, and close the batch only when you are done
                adding files.
              </CardDescription>
            </div>
          </div>
          {activeBatch ? (
            <StatusPill status={activeBatch.overallStatus} />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-5">
        {showEmptyState ? (
          <div className="flex min-h-72 flex-col justify-between gap-6 rounded-[1.5rem] border border-dashed border-border bg-muted/[0.16] px-6 py-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex max-w-xl items-start gap-4">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-background shadow-sm shadow-black/3">
                  <IconFolderOpen />
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-lg font-semibold tracking-tight">
                    Start a reusable intake batch
                  </p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Select one or more PDFs to prepare a batch draft. Each
                    PDF must contain one BIR 2307 certificate. The
                    batch is created when you start the upload and stays open
                    until you close it.
                  </p>
                </div>
              </div>
              <div className="grid gap-2 lg:min-w-72">
                <EmptyStateSupport
                  icon={<IconStack2 />}
                  title="Multiple files per batch"
                  detail="Group related uploads under one persisted intake batch."
                />
                <EmptyStateSupport
                  icon={<IconTimeline />}
                  title="Independent processing"
                  detail="Each file uploads, queues, and finishes on its own."
                />
                <EmptyStateSupport
                  icon={<IconShieldCheck />}
                  title="Resume later"
                  detail="Your open batch reappears when you return to /upload."
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-background/90 px-4 py-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  Ready to build a batch
                </p>
                <p className="text-sm text-muted-foreground">
                  Choose PDF files now, then upload them together into a new
                  intake batch.
                </p>
              </div>
              <Button type="button" size="lg" onClick={onSelectFiles}>
                <IconFilePlus data-icon="inline-start" />
                Select PDF files
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-[1.5rem] border border-border/90 bg-muted/[0.16] p-4 shadow-inner shadow-black/[0.02]">
              <div className="flex flex-col gap-4 rounded-[1.25rem] border border-border/80 bg-background/90 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-background shadow-sm shadow-black/3">
                      <IconStack2 />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-muted-foreground">
                          Batch
                        </p>
                        {activeBatch ? (
                          <Badge
                            variant="outline"
                            className="h-6 rounded-full border-border/80 bg-muted/20 px-2 text-muted-foreground"
                          >
                            {activeBatch.status === 'open' ? 'Open' : 'Closed'}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="h-6 rounded-full border-border/80 bg-muted/20 px-2 text-muted-foreground"
                          >
                            Draft
                          </Badge>
                        )}
                      </div>
                      <p
                        className={cn(
                          'truncate text-lg font-semibold tracking-tight',
                          activeBatch?.name ? undefined : 'font-mono',
                        )}
                      >
                        {activeBatch
                          ? getBatchDisplayName(activeBatch)
                          : 'Pending creation'}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        {activeBatch?.name ? (
                          <>
                            <span className="font-mono">{activeBatch.id}</span>
                            <span className="size-1 rounded-full bg-border" />
                          </>
                        ) : null}
                        <span>
                          {activeBatch
                            ? `${activeBatch.totalFiles} files in batch`
                            : `${rows.length} files selected`}
                        </span>
                        <span className="size-1 rounded-full bg-border" />
                        <span>
                          {activeBatch
                            ? `Last activity ${formatDateTime(activeBatch.lastActivityAt)}`
                            : 'Choose Upload selected to create the batch'}
                        </span>
                      </div>
                      {activeBatch ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="w-fit px-0 text-muted-foreground"
                          onClick={() => onOpenBatch(activeBatch.id)}
                        >
                          <IconArrowUpRight data-icon="inline-start" />
                          Open batch page
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {activeBatch ? (
                    <div className="grid gap-2 md:grid-cols-4">
                      <SummaryChip
                        label="Success"
                        value={activeBatch.counts.success}
                      />
                      <SummaryChip
                        label="Processing"
                        value={
                          activeBatch.counts.processing +
                          activeBatch.counts.queued
                        }
                      />
                      <SummaryChip
                        label="Pending"
                        value={activeBatch.counts.pending + pendingSelections}
                      />
                      <SummaryChip
                        label="Needs review"
                        value={activeBatch.openAttentionCount}
                        tone="warning"
                      />
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <SummaryChip label="Selected" value={rows.length} />
                      <SummaryChip
                        label="Ready to upload"
                        value={pendingSelections}
                      />
                    </div>
                  )}
                </div>

                <div className="max-h-[28rem] overflow-y-auto pr-1">
                  <div className="flex flex-col gap-3">
                    {rows.map((row) => (
                      <div
                        key={row.id}
                        className="rounded-2xl border border-border/80 bg-muted/[0.08] px-4 py-4"
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
                              <IconFileTypePdf />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate font-medium">
                                  {row.fileName}
                                </p>
                                <StatusPill status={row.statusLabel} />
                                {row.isPendingSelection ? (
                                  <Badge
                                    variant="outline"
                                    className="h-6 rounded-full border-border/80 bg-background px-2 text-muted-foreground"
                                  >
                                    Selected
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {formatBytes(row.sizeBytes)} · {row.detail}
                              </p>
                              {row.error ? (
                                <p className="mt-1 text-sm text-destructive">
                                  {row.error}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <div className="min-w-32">
                              <div className="h-2 rounded-full bg-muted">
                                <div
                                  className={cn(
                                    'h-2 rounded-full transition-all',
                                    row.statusLabel === 'Error'
                                      ? 'bg-destructive/70'
                                      : row.statusLabel === 'Duplicate'
                                        ? 'bg-amber-500/70'
                                        : 'bg-primary/70',
                                  )}
                                  style={{
                                    width: `${Math.max(row.progress, 4)}%`,
                                  }}
                                />
                              </div>
                              <p className="mt-1 text-right text-xs text-muted-foreground">
                                {row.progress}%
                              </p>
                            </div>
                            {row.uploadId ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => onOpenDestination(row.uploadId)}
                              >
                                <IconArrowUpRight data-icon="inline-start" />
                                Open
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-muted/[0.12] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={onSelectFiles}>
                  <IconFilePlus data-icon="inline-start" />
                  Add files
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={canStartUpload ? 'default' : 'outline'}
                  onClick={onStartUpload}
                  disabled={!canStartUpload || isStartingUpload}
                >
                  {isStartingUpload ? (
                    <IconLoader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <IconUpload data-icon="inline-start" />
                  )}
                  {isStartingUpload
                    ? 'Preparing batch...'
                    : canStartUpload
                      ? `Upload selected (${pendingSelections})`
                      : 'No files ready'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onCloseBatch}
                  disabled={
                    !activeBatch || hasBlockingLocalWork || isClosingBatch
                  }
                >
                  <IconX data-icon="inline-start" />
                  Close batch
                </Button>
              </div>
              <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                Add more files any time while the batch stays open. Close it
                when you are done collecting uploads for this batch.
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

function SummaryChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'warning'
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'flex h-8 w-full items-center justify-between gap-2 rounded-xl border px-2.5 text-left',
        tone === 'warning'
          ? 'border-amber-500/25 bg-amber-500/8 text-amber-700'
          : 'border-border/80 bg-muted/30 text-foreground',
      )}
    >
      <span className="rounded-full bg-background/85 px-1.5 py-0.5 text-xs font-semibold tabular-nums">
        {value}
      </span>
      <span className="truncate text-xs leading-none">{label}</span>
    </Badge>
  )
}

function RecentBatchesCard({
  activeBatch,
  recentBatches,
  onOpenBatch,
}: {
  activeBatch: IntakeBatchView | null
  recentBatches: Array<IntakeBatchView>
  onOpenBatch: (batchId: string | null | undefined) => void
}) {
  const batches = activeBatch
    ? [
        activeBatch,
        ...recentBatches.filter((batch) => batch.id !== activeBatch.id),
      ]
    : recentBatches

  return (
    <Card className="border-border/90 bg-card shadow-sm shadow-black/3">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg font-semibold tracking-tight">
            Recent batches
          </CardTitle>
          <Badge
            variant="outline"
            className="h-6 rounded-full border-border/80 bg-muted/20 px-2 text-muted-foreground"
          >
            {batches.length} batches
          </Badge>
        </div>
        <CardDescription className="leading-6">
          Batch history across recently active upload batches.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {batches.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-border/80 bg-background px-4 py-4 text-sm text-muted-foreground">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/30">
              <IconStack2 />
            </div>
            <div>
              <p className="font-medium text-foreground">
                No recent batches yet.
              </p>
              <p className="mt-1">
                Your current open batch and older batches will appear here
                once upload activity begins.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/80 bg-background">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/[0.18] hover:bg-muted/[0.18]">
                  <TableHead>Batch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id} className="hover:bg-muted/[0.16]">
                    <TableCell className="max-w-[20rem] whitespace-normal align-top">
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'font-medium',
                              batch.name ? undefined : 'font-mono',
                            )}
                          >
                            {getBatchDisplayName(batch)}
                          </span>
                          {activeBatch?.id === batch.id ? (
                            <Badge
                              variant="outline"
                              className="h-6 rounded-full border-primary/20 bg-primary/5 px-2 text-primary"
                            >
                              Current
                            </Badge>
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {batch.name ? (
                            <span className="font-mono">{batch.id} · </span>
                          ) : null}
                          {batch.counts.success} done,{' '}
                          {batch.openAttentionCount} needing review
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusPill status={batch.overallStatus} />
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {batch.totalFiles}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {formatDateTime(batch.lastActivityAt)}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenBatch(batch.id)}
                      >
                        <IconArrowUpRight data-icon="inline-start" />
                        Open batch
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

function UploadRulesCard() {
  const [helpOpen, setHelpOpen] = useState(false)
  const rules = [
    {
      title: 'Multiple PDFs per batch',
      detail: 'Build one intake batch and add several PDFs into it over time.',
      icon: <IconStack2 />,
    },
    {
      title: 'One open batch per user',
      detail:
        'Returning to /upload resumes your current open batch automatically.',
      icon: <IconFolderOpen />,
    },
    {
      title: 'Files process independently',
      detail:
        'Each PDF uploads, queues, and completes without blocking the rest.',
      icon: <IconTimeline />,
    },
    {
      title: 'Close batches manually',
      detail:
        'Keep adding files until the batch is complete, then close the batch.',
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
          Batch rules
        </CardTitle>
        <CardDescription className="leading-6">
          Keep upload batches organized so intake tracking stays predictable.
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
              Review upload batch rules
            </button>
          </div>
        </div>
      </CardContent>

      <Sheet open={helpOpen} onOpenChange={setHelpOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Upload batch rules</SheetTitle>
            <SheetDescription>
              Batches stay open until you close them, so use them to group
              related intake uploads intentionally.
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
              <div className="mt-2 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
                <p>
                  Select all PDFs you want to add to the current batch draft.
                </p>
                <p>
                  Start the upload only after reviewing the selected file list.
                </p>
                <p>
                  Use a new batch when the uploads belong to a different
                  intake run.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-border/80 bg-background px-4 py-4">
              <p className="text-sm font-medium">If the upload needs review</p>
              <div className="mt-2 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
                <p>
                  Open the file details to inspect duplicates or validation
                  failures.
                </p>
                <p>
                  Opening the issue detail automatically clears it from the
                  attention list.
                </p>
                <p>
                  Close the batch only after all intended files have been
                  added.
                </p>
              </div>
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
            Current operational load across active and recent batch files.
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
}: {
  items: ReturnType<typeof buildNeedsAttentionItems>
  onOpenDestination: (documentId: string | null | undefined) => void
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
          Failed validations, duplicates, and other follow-up cases across all
          recent batch files.
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
                Files that fail validation or hit duplicate checks will surface
                here.
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
                  Files
                </CardTitle>
                <Badge
                  variant="outline"
                  className="h-6 rounded-full border-border/80 bg-muted/20 px-2 text-muted-foreground"
                >
                  {jobsModel.counts.all} recent
                </Badge>
              </div>
              <CardDescription className="mt-1 leading-6">
                Recent batch files with their current processing outcome and
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
                No files match the current filters.
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
                  <TableHead>Result</TableHead>
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
                      {row.resultLabel}
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
