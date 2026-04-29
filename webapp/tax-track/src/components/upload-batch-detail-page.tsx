import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconCheck,
  IconChecks,
  IconClockHour4,
  IconDownload,
  IconEdit,
  IconFileTypePdf,
  IconListDetails,
  IconLoader2,
  IconSignature,
  IconStack2,
  IconX,
} from '@tabler/icons-react'
import { useMemo, useState } from 'react'

import type {
  IntakeBatchView,
  IntakeUploadView,
} from '@/lib/upload-intake-types'
import { buildNeedsAttentionItems } from '@/lib/upload-intake-view-model'
import { BatchReconciliationPanel } from '@/components/batch-reconciliation-panel'
import { StatusPill } from '@/components/status-pill'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
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
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

type UploadBatchDetailPageProps = {
  batch: IntakeBatchView | null
  isRefreshing: boolean
  isClosingBatch: boolean
  isExportingBir2307: boolean
  canExportSheet: boolean
  loadError: string | null
  onCloseBatch: () => void
  onExportBir2307: () => void
  onOpenSigning: () => void
  onOpenDestination: (documentId: string | null | undefined) => void
  onRenameBatch: (name: string | null) => Promise<boolean>
}

type BatchFileRow = {
  id: string
  uploadId: string
  fileName: string
  sizeBytes: number
  statusLabel: string
  uploadedAt: string | null
  latestActivityAt: string | null
  error: string | null
}

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

const toLatestActivity = (upload: IntakeUploadView) =>
  upload.processingFinishedAt ??
  upload.processingStartedAt ??
  upload.queuedAt ??
  upload.uploadedAt

const toServerStatusLabel = (upload: IntakeUploadView) => {
  switch (upload.overallStatus) {
    case 'success':
      return 'Done'
    case 'duplicate':
      return 'Duplicate'
    case 'error':
      return 'Error'
    case 'processing':
      return 'Processing'
    case 'queued':
      return 'Queued'
    case 'uploaded':
      return 'Uploaded'
    default:
      return 'Pending'
  }
}

const buildBatchFileRows = (
  batch: IntakeBatchView | null,
): Array<BatchFileRow> => {
  const serverRows =
    batch?.files.map<BatchFileRow>((upload) => ({
      id: upload.id,
      uploadId: upload.id,
      fileName: upload.fileName,
      sizeBytes: upload.sizeBytes,
      statusLabel: toServerStatusLabel(upload),
      uploadedAt: upload.uploadedAt,
      latestActivityAt: toLatestActivity(upload),
      error: upload.errorMessage,
    })) ?? []

  return serverRows
}

function OverviewStat({
  label,
  value,
  helper,
}: {
  label: string
  value: number
  helper: string
}) {
  return (
    <div className="rounded-2xl border border-border/80 bg-background/95 p-4 shadow-sm shadow-black/[0.03]">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{helper}</p>
    </div>
  )
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-background/90 p-4">
      <dt className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2 text-sm font-medium leading-6 text-foreground">
        {value}
      </dd>
    </div>
  )
}

function BatchHeroSkeleton() {
  return (
    <Card className="overflow-hidden rounded-3xl border-border/80 shadow-sm shadow-black/[0.04]">
      <CardHeader className="gap-6 border-b border-border/70 pb-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Skeleton className="size-14 rounded-2xl" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-6 w-28 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="h-9 w-72 max-w-full" />
              <Skeleton className="h-5 w-full max-w-2xl" />
              <Skeleton className="h-5 w-5/6 max-w-xl" />
            </div>
          </div>
          <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-[26rem]">
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 pt-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.95fr)]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36 rounded-3xl" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function BatchFilesSkeleton() {
  return (
    <Card className="rounded-3xl border-border/80 shadow-sm shadow-black/[0.04]">
      <CardHeader className="gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-14 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
      </CardContent>
    </Card>
  )
}

function BatchAttentionPanel({
  uploads,
  onOpenDestination,
}: {
  uploads: Array<IntakeUploadView>
  onOpenDestination: (documentId: string | null | undefined) => void
}) {
  const items = useMemo(() => buildNeedsAttentionItems(uploads), [uploads])

  return (
    <section aria-labelledby="batch-attention-heading">
      <Card className="rounded-3xl border-border/80 bg-card shadow-sm shadow-black/[0.04]">
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-muted/40 text-muted-foreground">
                <IconListDetails />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle
                    id="batch-attention-heading"
                    className="text-xl font-semibold tracking-tight"
                  >
                    Batch attention
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className="rounded-full border-border/80 bg-muted/20 px-2 text-muted-foreground"
                  >
                    {items.length} item{items.length === 1 ? '' : 's'}
                  </Badge>
                </div>
                <CardDescription className="mt-2 max-w-3xl leading-6">
                  Review duplicate and validation-error files without leaving
                  this batch.
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-3xl border border-border/80 bg-muted/[0.12] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-background text-primary">
                  <IconCheck />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-tight text-foreground">
                    Nothing needs review right now.
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Duplicate or failed files will surface here while the batch
                    is active.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <article
                  key={item.id}
                  className="rounded-3xl border border-border/80 bg-muted/[0.12] p-4 shadow-sm shadow-black/[0.02]"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-background text-muted-foreground">
                        <IconAlertTriangle />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground sm:text-base">
                            {item.fileName}
                          </p>
                          <StatusPill status={item.statusLabel} />
                        </div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {item.message}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenDestination(item.id)}
                        aria-label={`${item.actionLabel} for ${item.fileName}`}
                      >
                        <IconArrowUpRight data-icon="inline-start" />
                        {item.actionLabel}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

export function UploadBatchDetailPage({
  batch,
  isRefreshing,
  isClosingBatch,
  isExportingBir2307,
  canExportSheet,
  loadError,
  onCloseBatch,
  onExportBir2307,
  onOpenSigning,
  onOpenDestination,
  onRenameBatch,
}: UploadBatchDetailPageProps) {
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [batchNameInput, setBatchNameInput] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const rows = useMemo(() => buildBatchFileRows(batch), [batch])
  const canManageBatch = batch?.status === 'open'
  const isInitialLoading = isRefreshing && !loadError && !batch
  const batchStatusLabel =
    batch?.status === 'open' ? 'Open batch' : 'Closed batch'
  const processingCount =
    (batch?.counts.processing ?? 0) + (batch?.counts.queued ?? 0)
  const pendingCount = batch?.counts.pending ?? 0
  const canOpenSigning =
    batch?.canSignBatch || batch?.batchSigningStatus === 'signed'
  const batchDisplayName = batch?.name ?? batch?.id ?? 'Upload batch'
  const canExportBir2307 =
    Boolean(batch) && batch?.status === 'closed' && canExportSheet

  const openRenameSheet = () => {
    setBatchNameInput(batch?.name ?? '')
    setRenameError(null)
    setIsRenameOpen(true)
  }

  const saveBatchName = async () => {
    const normalizedName = batchNameInput.trim()
    if (normalizedName.length > 80) {
      setRenameError('Batch name must be 80 characters or fewer.')
      return
    }

    setIsRenaming(true)
    setRenameError(null)

    try {
      const renamed = await onRenameBatch(
        normalizedName.length > 0 ? normalizedName : null,
      )
      if (renamed) {
        setIsRenameOpen(false)
      }
    } finally {
      setIsRenaming(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 lg:gap-7">
      {loadError ? (
        <Alert
          variant="destructive"
          className="rounded-2xl border-destructive/30 bg-destructive/5"
        >
          <IconAlertTriangle />
          <AlertTitle>We could not load this batch.</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      {isInitialLoading ? (
        <>
          <BatchHeroSkeleton />
          <BatchFilesSkeleton />
        </>
      ) : (
        <Tabs defaultValue="batch" className="gap-6">
          <TabsList className="w-full justify-start overflow-x-auto rounded-2xl p-1 sm:w-fit">
            <TabsTrigger value="batch">Batch</TabsTrigger>
            <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          </TabsList>

          <TabsContent value="batch" className="flex flex-col gap-6">
            <section aria-labelledby="batch-overview-heading">
              <Card className="overflow-hidden rounded-3xl border-border/80 bg-card shadow-sm shadow-black/[0.04]">
                <CardHeader className="gap-6 border-b border-border/70 pb-6">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-muted/30 shadow-sm shadow-black/[0.03]">
                        <IconStack2 />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className="rounded-full border-border/80 bg-muted/20 px-2 text-muted-foreground"
                          >
                            {batchStatusLabel}
                          </Badge>
                          {batch ? (
                            <StatusPill status={batch.overallStatus} />
                          ) : null}
                        </div>
                        <CardTitle
                          id="batch-overview-heading"
                          className="mt-3 break-words text-3xl font-semibold tracking-tight"
                        >
                          {batchDisplayName}
                        </CardTitle>
                        {batch ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {batch.name ? (
                              <Badge
                                variant="outline"
                                className="rounded-full border-border/80 bg-muted/20 px-2 font-mono text-muted-foreground"
                              >
                                {batch.id}
                              </Badge>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={openRenameSheet}
                            >
                              <IconEdit data-icon="inline-start" />
                              Rename
                            </Button>
                          </div>
                        ) : null}
                        <CardDescription className="mt-3 max-w-3xl text-sm leading-7">
                          Review every file in this upload batch, keep new
                          uploads organized, and quickly resolve anything that
                          needs attention before downstream processing
                          continues.
                        </CardDescription>
                      </div>
                    </div>

                    <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-[30rem]">
                      {canOpenSigning ? (
                        <Button
                          type="button"
                          size="lg"
                          variant="outline"
                          onClick={onOpenSigning}
                        >
                          <IconSignature data-icon="inline-start" />
                          {batch.batchSigningStatus === 'signed'
                            ? 'View signed batch'
                            : 'Sign'}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        onClick={onExportBir2307}
                        disabled={!canExportBir2307 || isExportingBir2307}
                      >
                        {isExportingBir2307 ? (
                          <IconLoader2
                            data-icon="inline-start"
                            className="animate-spin"
                          />
                        ) : (
                          <IconDownload data-icon="inline-start" />
                        )}
                        {isExportingBir2307 ? 'Exporting...' : 'Export 2307'}
                      </Button>
                      <Button
                        type="button"
                        size="lg"
                        variant="destructive"
                        onClick={onCloseBatch}
                        disabled={!canManageBatch || isClosingBatch}
                      >
                        <IconX data-icon="inline-start" />
                        {isClosingBatch ? 'Closing...' : 'Close batch'}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="grid gap-6 pt-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.95fr)]">
                  <div className="flex flex-col gap-4">
                    <div className="rounded-3xl border border-border/80 bg-muted/[0.12] p-5">
                      <div className="flex items-center gap-2">
                        <IconClockHour4 className="text-muted-foreground" />
                        <h2 className="text-base font-semibold tracking-tight">
                          Batch details
                        </h2>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Core timing and file-count details for this persisted
                        upload batch.
                      </p>
                      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                        <MetadataItem
                          label="Batch ID"
                          value={batch?.id ?? '—'}
                        />
                        <MetadataItem
                          label="Created"
                          value={formatDateTime(batch?.createdAt)}
                        />
                        <MetadataItem
                          label="Last activity"
                          value={formatDateTime(batch?.lastActivityAt)}
                        />
                        <MetadataItem
                          label="Closed"
                          value={formatDateTime(batch?.closedAt)}
                        />
                        <MetadataItem
                          label="Files in batch"
                          value={
                            batch ? `${batch.totalFiles} persisted files` : '—'
                          }
                        />
                      </dl>
                    </div>

                    <div className="rounded-3xl border border-border/80 bg-background/95 p-5 shadow-sm shadow-black/[0.03]">
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-muted/30 text-muted-foreground">
                          <IconChecks />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-base font-semibold tracking-tight">
                            Workflow guidance
                          </h2>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {canManageBatch
                              ? 'This batch is still open. Close the batch when you are done accepting files from the upload workspace.'
                              : 'This batch is closed. You can still review file outcomes and open related document details from the table below.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="rounded-3xl border border-border/80 bg-muted/[0.12] p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold tracking-tight">
                            Outcome summary
                          </h2>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            A quick view of completed, active, and review-needed
                            work in this batch.
                          </p>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <OverviewStat
                          label="Success"
                          value={batch?.counts.success ?? 0}
                          helper="Finished and ready to inspect."
                        />
                        <OverviewStat
                          label="Processing"
                          value={processingCount}
                          helper="Queued or currently processing."
                        />
                        <OverviewStat
                          label="Pending"
                          value={pendingCount}
                          helper="Awaiting upload or batch progress."
                        />
                        <OverviewStat
                          label="Needs review"
                          value={batch?.openAttentionCount ?? 0}
                          helper="Duplicate or failed file outcomes."
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            {batch ? (
              <BatchAttentionPanel
                uploads={batch.files}
                onOpenDestination={onOpenDestination}
              />
            ) : null}

            <section aria-labelledby="batch-files-heading">
              <Card className="rounded-3xl border-border/80 bg-card shadow-sm shadow-black/[0.04]">
                <CardHeader className="gap-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle
                          id="batch-files-heading"
                          className="text-xl font-semibold tracking-tight"
                        >
                          Batch files
                        </CardTitle>
                        <Badge
                          variant="outline"
                          className="rounded-full border-border/80 bg-muted/20 px-2 text-muted-foreground"
                        >
                          {rows.length} row{rows.length === 1 ? '' : 's'}
                        </Badge>
                      </div>
                      <CardDescription className="mt-2 max-w-3xl leading-6">
                        Persisted uploads in this batch, with current processing
                        status and links to document details.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  {rows.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-border/80 bg-muted/[0.12] p-6">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-start gap-4">
                          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-background text-muted-foreground">
                            <IconFileTypePdf />
                          </div>
                          <div className="min-w-0">
                            <p className="text-base font-semibold tracking-tight text-foreground">
                              No files in this batch yet.
                            </p>
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              {canManageBatch
                                ? 'Files added from the upload workspace will appear here.'
                                : 'This closed batch has no visible file activity yet.'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-3xl border border-border/80 bg-background/95 shadow-inner shadow-black/[0.02]">
                      <Table className="min-w-[760px]">
                        <TableHeader className="[&_tr]:border-border/80">
                          <TableRow className="bg-muted/[0.2] hover:bg-muted/[0.2]">
                            <TableHead className="sticky top-0 w-[24rem] bg-muted/[0.2] px-4 py-4">
                              File
                            </TableHead>
                            <TableHead className="sticky top-0 bg-muted/[0.2] px-4 py-4">
                              Status
                            </TableHead>
                            <TableHead className="sticky top-0 bg-muted/[0.2] px-4 py-4 text-right">
                              Size
                            </TableHead>
                            <TableHead className="sticky top-0 bg-muted/[0.2] px-4 py-4">
                              Uploaded
                            </TableHead>
                            <TableHead className="sticky top-0 bg-muted/[0.2] px-4 py-4">
                              Last activity
                            </TableHead>
                            <TableHead className="sticky top-0 bg-muted/[0.2] px-4 py-4 text-right">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody className="[&_tr:last-child]:border-b-0">
                          {rows.map((row) => (
                            <TableRow
                              key={row.id}
                              className={cn(
                                'border-border/70 bg-background/95 hover:bg-muted/[0.14]',
                                row.error ? 'bg-destructive/[0.02]' : undefined,
                              )}
                            >
                              <TableCell className="max-w-[24rem] px-4 py-4 align-top whitespace-normal">
                                <div className="flex min-w-0 items-start gap-3">
                                  <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/80 bg-muted/20 text-muted-foreground">
                                    <IconFileTypePdf />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="truncate text-sm font-semibold text-foreground">
                                        {row.fileName}
                                      </span>
                                    </div>
                                    {row.error ? (
                                      <p className="mt-2 text-sm leading-6 text-destructive">
                                        {row.error}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-4 align-top">
                                <StatusPill status={row.statusLabel} />
                              </TableCell>
                              <TableCell className="px-4 py-4 text-right align-top font-medium text-foreground">
                                {formatBytes(row.sizeBytes)}
                              </TableCell>
                              <TableCell className="px-4 py-4 align-top whitespace-normal text-muted-foreground">
                                {formatDateTime(row.uploadedAt)}
                              </TableCell>
                              <TableCell className="px-4 py-4 align-top whitespace-normal text-muted-foreground">
                                {formatDateTime(row.latestActivityAt)}
                              </TableCell>
                              <TableCell className="px-4 py-4 align-top">
                                <div className="flex flex-wrap justify-end gap-2">
                                  {row.uploadId ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        onOpenDestination(row.uploadId)
                                      }
                                      aria-label={`Open file details for ${row.fileName}`}
                                    >
                                      <IconArrowUpRight data-icon="inline-start" />
                                      Open
                                    </Button>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </TabsContent>

          <TabsContent value="reconciliation">
            <BatchReconciliationPanel
              batch={batch}
              canExportSheet={canExportSheet}
            />
          </TabsContent>
        </Tabs>
      )}

      <Sheet open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Rename upload batch</SheetTitle>
            <SheetDescription>
              Give this upload batch a short name for easier lookup.
            </SheetDescription>
          </SheetHeader>

          <div className="px-6">
            <FieldGroup>
              <Field data-invalid={Boolean(renameError)}>
                <FieldLabel htmlFor="batch-name">Batch name</FieldLabel>
                <Input
                  id="batch-name"
                  value={batchNameInput}
                  maxLength={80}
                  aria-invalid={Boolean(renameError)}
                  disabled={isRenaming}
                  placeholder="April withholding batch"
                  onChange={(event) => {
                    setBatchNameInput(event.target.value)
                    if (renameError) {
                      setRenameError(null)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void saveBatchName()
                    }
                  }}
                />
                <FieldDescription>
                  Leave blank to show the batch ID instead.
                </FieldDescription>
                <FieldError>{renameError}</FieldError>
              </Field>
            </FieldGroup>
          </div>

          <SheetFooter>
            <Button
              type="button"
              onClick={() => void saveBatchName()}
              disabled={isRenaming || !batch}
            >
              {isRenaming ? (
                <IconLoader2
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <IconCheck data-icon="inline-start" />
              )}
              {isRenaming ? 'Saving...' : 'Save name'}
            </Button>
            <SheetClose render={<Button type="button" variant="outline" />}>
              Cancel
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
