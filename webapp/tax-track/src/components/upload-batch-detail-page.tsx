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
  IconRefresh,
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
  isReopeningBatch: boolean
  isExportingBir2307: boolean
  canExportSheet: boolean
  loadError: string | null
  onCloseBatch: () => void
  onReopenBatch: () => void
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
const PANEL_CARD_CLASS = 'border border-border/70 shadow-sm'
const PANEL_BORDER_CLASS = 'border-border/70'

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
    <div
      className={cn('rounded-lg border bg-muted/20 p-3', PANEL_BORDER_CLASS)}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold leading-none">{value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{helper}</p>
    </div>
  )
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div
      className={cn('rounded-lg border bg-muted/20 p-3', PANEL_BORDER_CLASS)}
    >
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium text-foreground">
        {value}
      </dd>
    </div>
  )
}

function BatchHeroSkeleton() {
  return (
    <Card size="sm" className={PANEL_CARD_CLASS}>
      <CardHeader className={cn('gap-4 border-b', PANEL_BORDER_CLASS)}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-5 w-24 rounded-md" />
                <Skeleton className="h-5 w-20 rounded-md" />
              </div>
              <Skeleton className="h-6 w-72 max-w-full" />
              <Skeleton className="h-4 w-full max-w-2xl" />
              <Skeleton className="h-4 w-5/6 max-w-xl" />
            </div>
          </div>
          <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-[26rem]">
            <Skeleton className="h-9 rounded-lg" />
            <Skeleton className="h-9 rounded-lg" />
            <Skeleton className="h-9 rounded-lg" />
            <Skeleton className="h-9 rounded-lg" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.95fr)]">
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 rounded-lg" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function BatchFilesSkeleton() {
  return (
    <Card size="sm" className={PANEL_CARD_CLASS}>
      <CardHeader className="gap-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
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
      <Card size="sm" className={PANEL_CARD_CLASS}>
        <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/20 text-muted-foreground',
                  PANEL_BORDER_CLASS,
                )}
              >
                <IconListDetails className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle id="batch-attention-heading" className="text-sm">
                    Batch attention
                  </CardTitle>
                  <Badge variant="outline">
                    {items.length} item{items.length === 1 ? '' : 's'}
                  </Badge>
                </div>
                <CardDescription className="mt-1 max-w-3xl text-xs">
                  Review duplicate and validation-error files without leaving
                  this batch.
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div
              className={cn(
                'rounded-lg border bg-muted/20 p-3',
                PANEL_BORDER_CLASS,
              )}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-primary',
                    PANEL_BORDER_CLASS,
                  )}
                >
                  <IconCheck className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Nothing needs review right now.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
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
                  className={cn(
                    'rounded-lg border bg-muted/20 p-3',
                    PANEL_BORDER_CLASS,
                  )}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground',
                          PANEL_BORDER_CLASS,
                        )}
                      >
                        <IconAlertTriangle className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {item.fileName}
                          </p>
                          <StatusPill status={item.statusLabel} />
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
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
  isReopeningBatch,
  isExportingBir2307,
  canExportSheet,
  loadError,
  onCloseBatch,
  onReopenBatch,
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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      {loadError ? (
        <Alert
          variant="destructive"
          className="rounded-lg border-destructive/30 bg-destructive/5"
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
        <Tabs defaultValue="batch" className="gap-4">
          <TabsList
            className={cn(
              'w-full justify-start overflow-x-auto rounded-lg border p-1 sm:w-fit',
              PANEL_BORDER_CLASS,
            )}
          >
            <TabsTrigger value="batch">Batch</TabsTrigger>
            <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          </TabsList>

          <TabsContent value="batch" className="flex flex-col gap-4">
            <section aria-labelledby="batch-overview-heading">
              <Card size="sm" className={PANEL_CARD_CLASS}>
                <CardHeader
                  className={cn('gap-4 border-b', PANEL_BORDER_CLASS)}
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={cn(
                          'flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/20 text-muted-foreground',
                          PANEL_BORDER_CLASS,
                        )}
                      >
                        <IconStack2 className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{batchStatusLabel}</Badge>
                          {batch ? (
                            <StatusPill status={batch.overallStatus} />
                          ) : null}
                        </div>
                        <CardTitle
                          id="batch-overview-heading"
                          className="mt-2 break-words text-xl font-semibold tracking-tight"
                        >
                          {batchDisplayName}
                        </CardTitle>
                        {batch ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {batch.name ? (
                              <Badge
                                variant="outline"
                                className="font-mono text-muted-foreground"
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
                        <CardDescription className="mt-3 max-w-3xl text-xs leading-5">
                          Review every file in this upload batch, keep new
                          uploads organized, and quickly resolve anything that
                          needs attention before downstream processing
                          continues.
                        </CardDescription>
                      </div>
                    </div>

                    <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-[26rem]">
                      {canOpenSigning ? (
                        <Button
                          type="button"
                          size="sm"
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
                        size="sm"
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
                      {batch?.status === 'closed' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={onReopenBatch}
                          disabled={isReopeningBatch}
                        >
                          {isReopeningBatch ? (
                            <IconLoader2
                              data-icon="inline-start"
                              className="animate-spin"
                            />
                          ) : (
                            <IconRefresh data-icon="inline-start" />
                          )}
                          {isReopeningBatch ? 'Re-opening...' : 'Re-open batch'}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={onCloseBatch}
                          disabled={!canManageBatch || isClosingBatch}
                        >
                          <IconX data-icon="inline-start" />
                          {isClosingBatch ? 'Closing...' : 'Close batch'}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.95fr)]">
                  <div className="flex flex-col gap-3">
                    <div
                      className={cn(
                        'rounded-lg border bg-muted/20 p-3',
                        PANEL_BORDER_CLASS,
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <IconClockHour4 className="size-4 text-muted-foreground" />
                        <h2 className="text-sm font-semibold">Batch details</h2>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Core timing and file-count details for this persisted
                        upload batch.
                      </p>
                      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
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

                    <div
                      className={cn(
                        'rounded-lg border bg-muted/20 p-3',
                        PANEL_BORDER_CLASS,
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground',
                            PANEL_BORDER_CLASS,
                          )}
                        >
                          <IconChecks className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-sm font-semibold">
                            Workflow guidance
                          </h2>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {canManageBatch
                              ? 'This batch is still open. Close the batch when you are done accepting files from the upload workspace.'
                              : 'This batch is closed. You can still review file outcomes and open related document details from the table below.'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div
                      className={cn(
                        'rounded-lg border bg-muted/20 p-3',
                        PANEL_BORDER_CLASS,
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-semibold">
                            Outcome summary
                          </h2>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            A quick view of completed, active, and review-needed
                            work in this batch.
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
              <Card size="sm" className={PANEL_CARD_CLASS}>
                <CardHeader
                  className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle id="batch-files-heading" className="text-sm">
                          Batch files
                        </CardTitle>
                        <Badge variant="outline">
                          {rows.length} row{rows.length === 1 ? '' : 's'}
                        </Badge>
                      </div>
                      <CardDescription className="mt-1 max-w-3xl text-xs">
                        Persisted uploads in this batch, with current processing
                        status and links to document details.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  {rows.length === 0 ? (
                    <div
                      className={cn(
                        'rounded-lg border border-dashed bg-muted/10 p-4',
                        PANEL_BORDER_CLASS,
                      )}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div
                            className={cn(
                              'flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground',
                              PANEL_BORDER_CLASS,
                            )}
                          >
                            <IconFileTypePdf className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">
                              No files in this batch yet.
                            </p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {canManageBatch
                                ? 'Files added from the upload workspace will appear here.'
                                : 'This closed batch has no visible file activity yet.'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'overflow-hidden rounded-lg border bg-background',
                        PANEL_BORDER_CLASS,
                      )}
                    >
                      <Table className="min-w-[760px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
                        <TableHeader className="[&_tr]:border-border/70">
                          <TableRow className="bg-muted/35 hover:bg-muted/35">
                            <TableHead className="sticky top-0 w-[22rem] bg-muted/35">
                              File
                            </TableHead>
                            <TableHead className="sticky top-0 bg-muted/35">
                              Status
                            </TableHead>
                            <TableHead className="sticky top-0 bg-muted/35 text-right">
                              Size
                            </TableHead>
                            <TableHead className="sticky top-0 bg-muted/35">
                              Uploaded
                            </TableHead>
                            <TableHead className="sticky top-0 bg-muted/35">
                              Last activity
                            </TableHead>
                            <TableHead className="sticky top-0 bg-muted/35 text-right">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody className="[&_tr:last-child]:border-b-0">
                          {rows.map((row) => (
                            <TableRow
                              key={row.id}
                              className={cn(
                                'border-border/70 bg-background hover:bg-muted/35',
                                row.error ? 'bg-destructive/[0.02]' : undefined,
                              )}
                            >
                              <TableCell className="max-w-[22rem] align-top whitespace-normal">
                                <div className="flex min-w-0 items-start gap-2">
                                  <div
                                    className={cn(
                                      'flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/20 text-muted-foreground',
                                      PANEL_BORDER_CLASS,
                                    )}
                                  >
                                    <IconFileTypePdf className="size-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="truncate text-xs font-semibold text-foreground">
                                        {row.fileName}
                                      </span>
                                    </div>
                                    {row.error ? (
                                      <p className="mt-1 text-xs leading-5 text-destructive">
                                        {row.error}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="align-top">
                                <StatusPill status={row.statusLabel} />
                              </TableCell>
                              <TableCell className="text-right align-top font-medium text-foreground">
                                {formatBytes(row.sizeBytes)}
                              </TableCell>
                              <TableCell className="align-top whitespace-normal text-muted-foreground">
                                {formatDateTime(row.uploadedAt)}
                              </TableCell>
                              <TableCell className="align-top whitespace-normal text-muted-foreground">
                                {formatDateTime(row.latestActivityAt)}
                              </TableCell>
                              <TableCell className="align-top">
                                <div className="flex flex-wrap justify-end gap-2">
                                  {row.uploadId ? (
                                    <Button
                                      type="button"
                                      size="xs"
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
