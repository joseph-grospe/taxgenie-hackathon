import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconCheck,
  IconChecks,
  IconChevronLeft,
  IconChevronRight,
  IconClockHour4,
  IconDownload,
  IconEdit,
  IconFileTypePdf,
  IconListDetails,
  IconLoader2,
  IconRefresh,
  IconSearch,
  IconSignature,
  IconStack2,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  BatchFileStatusFilter,
  BatchFilesFilterOptions,
  BatchFilesResponse,
  BatchListPagination,
  IntakeBatchView,
  IntakeUploadView,
} from '@/lib/upload-intake-types'
import type {
  BatchDetailSearch,
  BatchDetailTab,
} from '@/lib/batch-file-search-state'
import { buildNeedsAttentionItems } from '@/lib/upload-intake-view-model'
import {
  BATCH_FILE_PAGE_SIZE_OPTIONS,
  DEFAULT_BATCH_ATTENTION_PAGE_SIZE,
  DEFAULT_BATCH_FILE_PAGE_SIZE,
  buildBatchFilesQueryParams,
} from '@/lib/batch-file-search-state'
import { StatusPill } from '@/components/status-pill'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
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
  isDeletingBatch: boolean
  isExportingBir2307: boolean
  canManageBatchActions: boolean
  canExportSheet: boolean
  loadError: string | null
  onCloseBatch: () => void
  onReopenBatch: () => void
  onDeleteBatch: () => void
  onExportBir2307: () => void
  onOpenSigning: () => void
  onOpenDestination: (documentId: string | null | undefined) => void
  onRenameBatch: (name: string | null) => Promise<boolean>
  search: BatchDetailSearch
  onSearchChange: (
    patch: Partial<BatchDetailSearch>,
    options?: { resetPage?: boolean },
  ) => void
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
  uploads: Array<IntakeUploadView>,
): Array<BatchFileRow> => {
  const serverRows = uploads.map<BatchFileRow>((upload) => ({
    id: upload.id,
    uploadId: upload.id,
    fileName: upload.fileName,
    sizeBytes: upload.sizeBytes,
    statusLabel: toServerStatusLabel(upload),
    uploadedAt: upload.uploadedAt,
    latestActivityAt: toLatestActivity(upload),
    error: upload.errorMessage,
  }))

  return serverRows
}

const DEFAULT_BATCH_FILES_PAGINATION: BatchListPagination = {
  page: 1,
  pageSize: DEFAULT_BATCH_FILE_PAGE_SIZE,
  totalItems: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

const DEFAULT_BATCH_ATTENTION_PAGINATION: BatchListPagination = {
  page: 1,
  pageSize: DEFAULT_BATCH_ATTENTION_PAGE_SIZE,
  totalItems: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

const DEFAULT_BATCH_FILE_FILTER_OPTIONS: BatchFilesFilterOptions = {
  statuses: [],
}

export const canExportBatchBir2307 = (
  batch: Pick<IntakeBatchView, 'status'> | null,
  canExportSheet: boolean,
) => {
  if (!batch) return false

  return batch.status === 'closed' && canExportSheet
}

export const canDeleteUploadBatch = (
  batch: Pick<IntakeBatchView, 'status' | 'deletedAt'> | null,
  canManageBatchActions: boolean,
) => {
  if (!batch) return false

  return canManageBatchActions && batch.status === 'closed' && !batch.deletedAt
}

const formatFileStatusFilter = (status: BatchFileStatusFilter) => {
  switch (status) {
    case 'all':
      return 'All statuses'
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
    case 'pending':
      return 'Pending'
    default:
      return status
  }
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
  batchId,
  totalCount,
  onOpenDestination,
}: {
  batchId: string | null
  totalCount: number
  onOpenDestination: (documentId: string | null | undefined) => void
}) {
  const [uploads, setUploads] = useState<Array<IntakeUploadView>>([])
  const [pagination, setPagination] = useState(
    DEFAULT_BATCH_ATTENTION_PAGINATION,
  )
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const items = useMemo(() => buildNeedsAttentionItems(uploads), [uploads])
  const startRow =
    pagination.totalItems === 0 || items.length === 0
      ? 0
      : (pagination.page - 1) * pagination.pageSize + 1
  const endRow =
    pagination.totalItems === 0 || items.length === 0
      ? 0
      : Math.min(pagination.page * pagination.pageSize, pagination.totalItems)

  const refreshAttention = useCallback(async () => {
    if (!batchId) {
      setUploads([])
      setPagination(DEFAULT_BATCH_ATTENTION_PAGINATION)
      return
    }

    setIsLoading(true)

    try {
      const query = buildBatchFilesQueryParams({
        q: '',
        status: 'all',
        attention: 'open',
        page,
        pageSize: DEFAULT_BATCH_ATTENTION_PAGE_SIZE,
      })
      const response = await fetch(
        `/api/uploads/batches/${encodeURIComponent(batchId)}/files?${query}`,
        { cache: 'no-store' },
      )
      const payload = (await response.json().catch(() => null)) as
        | (BatchFilesResponse & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load attention items (${response.status}).`,
        )
      }

      setUploads(Array.isArray(payload?.files) ? payload.files : [])
      setPagination(payload?.pagination ?? DEFAULT_BATCH_ATTENTION_PAGINATION)
      setLoadError(null)
    } catch (error) {
      setUploads([])
      setPagination(DEFAULT_BATCH_ATTENTION_PAGINATION)
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load attention items.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [batchId, page])

  useEffect(() => {
    void refreshAttention()
  }, [refreshAttention])

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
                    {totalCount.toLocaleString()} item
                    {totalCount === 1 ? '' : 's'}
                  </Badge>
                </div>
                <CardDescription className="mt-1 max-w-3xl text-xs">
                  Review duplicate and validation-error files in manageable
                  pages.
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {loadError ? (
            <Alert variant="destructive" className="rounded-lg">
              <IconAlertTriangle />
              <AlertTitle>Unable to load attention items</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : null}

          {isLoading && items.length === 0 ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }, (_item, index) => (
                <Skeleton key={index} className="h-20 rounded-lg" />
              ))}
            </div>
          ) : items.length === 0 ? (
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
                    Duplicate or failed files will surface here without
                    stretching the page.
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
          {pagination.totalItems > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Showing {startRow}-{endRow} of{' '}
                {pagination.totalItems.toLocaleString()} items
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasPreviousPage || isLoading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <IconChevronLeft data-icon="inline-start" />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasNextPage || isLoading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                  <IconChevronRight data-icon="inline-end" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function BatchFilesPanel({
  batchId,
  totalFiles,
  batchStatus,
  search,
  onOpenDestination,
  onSearchChange,
}: {
  batchId: string | null
  totalFiles: number
  batchStatus: IntakeBatchView['status'] | null
  search: BatchDetailSearch
  onOpenDestination: (documentId: string | null | undefined) => void
  onSearchChange: (
    patch: Partial<BatchDetailSearch>,
    options?: { resetPage?: boolean },
  ) => void
}) {
  const [uploads, setUploads] = useState<Array<IntakeUploadView>>([])
  const [pagination, setPagination] = useState(DEFAULT_BATCH_FILES_PAGINATION)
  const [filterOptions, setFilterOptions] = useState(
    DEFAULT_BATCH_FILE_FILTER_OPTIONS,
  )
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const rows = useMemo(() => buildBatchFileRows(uploads), [uploads])
  const queryString = useMemo(
    () => buildBatchFilesQueryParams(search).toString(),
    [search],
  )
  const startRow =
    pagination.totalItems === 0 || rows.length === 0
      ? 0
      : (pagination.page - 1) * pagination.pageSize + 1
  const endRow =
    pagination.totalItems === 0 || rows.length === 0
      ? 0
      : Math.min(pagination.page * pagination.pageSize, pagination.totalItems)

  const updateSearch = useCallback(
    (
      patch: Partial<BatchDetailSearch>,
      options: { resetPage?: boolean } = {},
    ) => {
      onSearchChange(
        { tab: 'files', ...patch },
        { resetPage: options.resetPage },
      )
    },
    [onSearchChange],
  )

  const refreshFiles = useCallback(async () => {
    if (!batchId) {
      setUploads([])
      setPagination(DEFAULT_BATCH_FILES_PAGINATION)
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch(
        `/api/uploads/batches/${encodeURIComponent(batchId)}/files?${queryString}`,
        { cache: 'no-store' },
      )
      const payload = (await response.json().catch(() => null)) as
        | (BatchFilesResponse & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to load batch files (${response.status}).`,
        )
      }

      setUploads(Array.isArray(payload?.files) ? payload.files : [])
      setPagination(payload?.pagination ?? DEFAULT_BATCH_FILES_PAGINATION)
      setFilterOptions(
        payload?.filterOptions ?? DEFAULT_BATCH_FILE_FILTER_OPTIONS,
      )
      setLoadError(null)
    } catch (error) {
      setUploads([])
      setPagination(DEFAULT_BATCH_FILES_PAGINATION)
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load batch files.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [batchId, queryString])

  useEffect(() => {
    void refreshFiles()
  }, [refreshFiles])

  return (
    <section aria-labelledby="batch-files-heading">
      <Card size="sm" className={PANEL_CARD_CLASS}>
        <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle id="batch-files-heading" className="text-sm">
                  Batch files
                </CardTitle>
                <Badge variant="outline">
                  {totalFiles.toLocaleString()} total
                </Badge>
                <Badge variant="secondary">
                  {pagination.totalItems.toLocaleString()} in view
                </Badge>
              </div>
              <CardDescription className="mt-1 max-w-3xl text-xs">
                Persisted uploads in this batch, loaded a page at a time.
              </CardDescription>
            </div>
          </div>
          <FieldGroup className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_minmax(10rem,14rem)_minmax(8rem,10rem)]">
            <Field>
              <FieldLabel htmlFor="batch-file-search" className="text-xs">
                Search
              </FieldLabel>
              <div className="relative min-w-0">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="batch-file-search"
                  value={search.q}
                  className="pl-9"
                  placeholder="File, error, processing step"
                  onChange={(event) =>
                    updateSearch({ q: event.currentTarget.value })
                  }
                />
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="batch-file-status" className="text-xs">
                Status
              </FieldLabel>
              <select
                id="batch-file-status"
                value={search.status}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  updateSearch({
                    status: event.currentTarget.value as BatchFileStatusFilter,
                  })
                }
              >
                <option value="all">All statuses</option>
                {filterOptions.statuses.map((status) => (
                  <option key={status} value={status}>
                    {formatFileStatusFilter(status)}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="batch-file-page-size" className="text-xs">
                Rows
              </FieldLabel>
              <select
                id="batch-file-page-size"
                value={search.pageSize}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  updateSearch({
                    pageSize: Number.parseInt(event.currentTarget.value, 10),
                  })
                }
              >
                {BATCH_FILE_PAGE_SIZE_OPTIONS.map((pageSize) => (
                  <option key={pageSize} value={pageSize}>
                    {pageSize}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGroup>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {loadError ? (
            <Alert variant="destructive" className="rounded-lg">
              <IconAlertTriangle />
              <AlertTitle>Unable to load batch files</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : null}
          {isLoading && rows.length === 0 ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
              <Skeleton className="h-12 rounded-lg" />
            </div>
          ) : rows.length === 0 ? (
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
                      No files match this view.
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {batchStatus === 'open'
                        ? 'Files added from the upload workspace will appear here.'
                        : 'Adjust the search or status filter to inspect this batch.'}
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
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => onOpenDestination(row.uploadId)}
                            aria-label={`Open file details for ${row.fileName}`}
                          >
                            <IconArrowUpRight data-icon="inline-start" />
                            Open
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {startRow}-{endRow} of{' '}
              {pagination.totalItems.toLocaleString()} files
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!pagination.hasPreviousPage || isLoading}
                onClick={() =>
                  updateSearch(
                    { page: Math.max(1, pagination.page - 1) },
                    { resetPage: false },
                  )
                }
              >
                <IconChevronLeft data-icon="inline-start" />
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!pagination.hasNextPage || isLoading}
                onClick={() =>
                  updateSearch(
                    { page: pagination.page + 1 },
                    { resetPage: false },
                  )
                }
              >
                Next
                <IconChevronRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
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
  isDeletingBatch,
  isExportingBir2307,
  canManageBatchActions,
  canExportSheet,
  loadError,
  onCloseBatch,
  onReopenBatch,
  onDeleteBatch,
  onExportBir2307,
  onOpenSigning,
  onOpenDestination,
  onRenameBatch,
  search,
  onSearchChange,
}: UploadBatchDetailPageProps) {
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [batchNameInput, setBatchNameInput] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const canManageBatch = canManageBatchActions && batch?.status === 'open'
  const isInitialLoading = isRefreshing && !loadError && !batch
  const batchStatusLabel =
    batch?.status === 'open' ? 'Open batch' : 'Closed batch'
  const processingCount =
    (batch?.counts.processing ?? 0) + (batch?.counts.queued ?? 0)
  const pendingCount = batch?.counts.pending ?? 0
  const canOpenSigning =
    batch?.canSignBatch || batch?.batchSigningStatus === 'signed'
  const batchDisplayName = batch?.name ?? batch?.id ?? 'Upload batch'
  const canExportBir2307 = canExportBatchBir2307(batch, canExportSheet)
  const canDeleteBatch = canDeleteUploadBatch(batch, canManageBatchActions)

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
        <Tabs
          value={search.tab}
          onValueChange={(value) =>
            onSearchChange(
              { tab: value as BatchDetailTab },
              { resetPage: false },
            )
          }
          className="gap-4"
        >
          <TabsList
            className={cn(
              'w-full justify-start overflow-x-auto rounded-lg border p-1 sm:w-fit',
              PANEL_BORDER_CLASS,
            )}
          >
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="attention">Needs attention</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex flex-col gap-4">
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
                            {canManageBatchActions ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={openRenameSheet}
                              >
                                <IconEdit data-icon="inline-start" />
                                Rename
                              </Button>
                            ) : null}
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
                      {canManageBatchActions && canOpenSigning ? (
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
                      {canManageBatchActions && batch?.status === 'closed' ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={onReopenBatch}
                            disabled={isReopeningBatch || isDeletingBatch}
                          >
                            {isReopeningBatch ? (
                              <IconLoader2
                                data-icon="inline-start"
                                className="animate-spin"
                              />
                            ) : (
                              <IconRefresh data-icon="inline-start" />
                            )}
                            {isReopeningBatch
                              ? 'Re-opening...'
                              : 'Re-open batch'}
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger
                              render={
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  disabled={!canDeleteBatch || isDeletingBatch}
                                />
                              }
                            >
                              {isDeletingBatch ? (
                                <IconLoader2
                                  data-icon="inline-start"
                                  className="animate-spin"
                                />
                              ) : (
                                <IconTrash data-icon="inline-start" />
                              )}
                              {isDeletingBatch ? 'Deleting...' : 'Delete batch'}
                            </AlertDialogTrigger>
                            <AlertDialogContent size="sm">
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Delete this batch?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This moves the closed batch to Recently
                                  Deleted for 30 days. It can be restored
                                  before the permanent purge date.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={isDeletingBatch}>
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  disabled={!canDeleteBatch || isDeletingBatch}
                                  onClick={onDeleteBatch}
                                >
                                  Delete batch
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      ) : canManageBatchActions ? (
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
                      ) : null}
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
                            {batch?.status === 'open'
                              ? 'This batch is still open. Close the batch when you are done accepting files from the upload workspace.'
                              : batch
                                ? 'This batch is closed. You can still review file outcomes and open related document details from the table below.'
                                : 'Batch details will appear here once the batch loads.'}
                          </p>
                          {!canManageBatchActions ? (
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              You have read-only access to this batch.
                            </p>
                          ) : null}
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
          </TabsContent>

          <TabsContent value="attention">
            <BatchAttentionPanel
              batchId={batch?.id ?? null}
              totalCount={batch?.openAttentionCount ?? 0}
              onOpenDestination={onOpenDestination}
            />
          </TabsContent>

          <TabsContent value="files">
            <BatchFilesPanel
              batchId={batch?.id ?? null}
              totalFiles={batch?.totalFiles ?? 0}
              batchStatus={batch?.status ?? null}
              search={search}
              onOpenDestination={onOpenDestination}
              onSearchChange={onSearchChange}
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
              disabled={isRenaming || !batch || !canManageBatchActions}
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
