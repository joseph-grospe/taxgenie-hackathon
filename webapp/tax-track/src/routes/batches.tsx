import {
  Link,
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconClockHour4,
  IconCopy,
  IconRefresh,
  IconSearch,
  IconStack2,
  IconTrash,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Icon } from '@tabler/icons-react'

import type {
  BatchListFilterOptions,
  BatchListPagination,
  BatchListResponse,
  BatchListRow,
  BatchListSummary,
  BatchRepositoryFilter,
} from '@/lib/upload-intake-types'
import type { BatchRouteSearch } from '@/lib/batch-search-state'
import { defaultBatchDetailSearch } from '@/lib/batch-file-search-state'
import { AppShell } from '@/components/app-shell'
import { BatchesTour } from '@/components/product-tour'
import { RefreshStatus } from '@/components/refresh-status'
import { StatusPill } from '@/components/status-pill'
import {
  preserveScrollDuringNavigation,
  useDebouncedRouteSearchInput,
} from '@/hooks/use-preserved-route-search'
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  BATCH_PAGE_SIZE_OPTIONS,
  buildBatchListQueryParams,
  defaultBatchSearch,
  hasActiveBatchFilters,
  parseBatchSearch,
} from '@/lib/batch-search-state'
import {
  BATCHES_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { createManilaDateFormatter } from '@/lib/manila-time'
import { cn } from '@/lib/utils'
import { formatPageLastUpdated } from '@/lib/active-polling'

export const Route = createFileRoute('/batches')({
  validateSearch: (search) => parseBatchSearch(search),
  component: RouteComponent,
})

const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'
const PANEL_BORDER_CLASS = 'border-border/60'
const INSET_BORDER_CLASS = 'border-border/60'

const DEFAULT_PAGINATION: BatchListPagination = {
  page: 1,
  pageSize: 25,
  totalItems: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

const DEFAULT_SUMMARY: BatchListSummary = {
  total: 0,
  active: 0,
  errors: 0,
  duplicates: 0,
  completed: 0,
}

const DEFAULT_FILTER_OPTIONS: BatchListFilterOptions = {
  statuses: [],
  signingStatuses: [],
}
const DEFAULT_BATCH_DETAIL_ROUTE_SEARCH = {
  ...defaultBatchSearch,
  ...defaultBatchDetailSearch,
  status: 'all' as const,
  attention: 'all' as const,
}

const DATE_TIME_FORMATTER = createManilaDateFormatter('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-'

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : DATE_TIME_FORMATTER.format(parsed)
}

const getBatchDisplayName = (batch: BatchListRow) => batch.name ?? batch.id

const formatSigningStatus = (status: BatchListRow['batchSigningStatus']) => {
  switch (status) {
    case 'unavailable':
      return 'Unavailable'
    case 'unsigned':
      return 'Unsigned'
    case 'partial':
      return 'Partially signed'
    case 'signed':
      return 'Signed'
    default:
      return status
  }
}

function SummaryTile({
  icon: IconComponent,
  label,
  value,
  description,
}: {
  icon: Icon
  label: string
  value: number
  description: string
}) {
  return (
    <Card size="sm" className={PANEL_CARD_CLASS}>
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
          <IconComponent className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold leading-none">
            {value.toLocaleString()}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function RouteComponent() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isBatchDetailRoute =
    pathname !== '/batches' && pathname.startsWith('/batches/')

  if (isBatchDetailRoute) {
    return <Outlet />
  }

  return <BatchesListPage />
}

function BatchesListPage() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const [batches, setBatches] = useState<Array<BatchListRow>>([])
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION)
  const [summary, setSummary] = useState(DEFAULT_SUMMARY)
  const [filterOptions, setFilterOptions] = useState(DEFAULT_FILTER_OPTIONS)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [restoringBatchId, setRestoringBatchId] = useState<string | null>(null)
  const [purgingBatchId, setPurgingBatchId] = useState<string | null>(null)
  const [batchPendingPurge, setBatchPendingPurge] =
    useState<BatchListRow | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const [tourStartSignal, setTourStartSignal] = useState(0)
  const activeFilterCount = useMemo(
    () =>
      [
        search.q,
        search.status !== 'all' ? search.status : '',
        search.signingStatus !== 'all' ? search.signingStatus : '',
        search.attention !== 'all' ? search.attention : '',
      ].filter(Boolean).length,
    [search],
  )
  const queryString = useMemo(
    () => buildBatchListQueryParams(search).toString(),
    [search],
  )
  const startRow =
    pagination.totalItems === 0 || batches.length === 0
      ? 0
      : (pagination.page - 1) * pagination.pageSize + 1
  const endRow =
    pagination.totalItems === 0 || batches.length === 0
      ? 0
      : Math.min(pagination.page * pagination.pageSize, pagination.totalItems)

  const updateSearch = useCallback(
    (
      patch: Partial<BatchRouteSearch>,
      options: { resetPage?: boolean } = { resetPage: true },
    ) => {
      void preserveScrollDuringNavigation(() =>
        navigate({
          search: (previous) =>
            parseBatchSearch({
              ...previous,
              ...patch,
              page:
                options.resetPage === false ? (patch.page ?? previous.page) : 1,
            }),
          replace: true,
          resetScroll: false,
        }),
      )
    },
    [navigate],
  )

  const {
    inputValue: batchSearchInput,
    setInputValue: setBatchSearchInput,
    commitInputValue: commitBatchSearchInput,
  } = useDebouncedRouteSearchInput({
    value: search.q,
    onCommit: (value) => updateSearch({ q: value }),
  })

  const refreshBatches = useCallback(async () => {
    setIsLoading(true)

    try {
      const response = await fetch(`/api/uploads/batches?${queryString}`, {
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => null)) as
        | (BatchListResponse & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to load batches (${response.status}).`,
        )
      }

      setBatches(Array.isArray(payload?.batches) ? payload.batches : [])
      setPagination(payload?.pagination ?? DEFAULT_PAGINATION)
      setSummary(payload?.summary ?? DEFAULT_SUMMARY)
      setFilterOptions(payload?.filterOptions ?? DEFAULT_FILTER_OPTIONS)
      setLastRefreshedAt(new Date())
      setLoadError(null)
    } catch (error) {
      setBatches([])
      setPagination(DEFAULT_PAGINATION)
      setSummary(DEFAULT_SUMMARY)
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load batches.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [queryString])

  const restoreBatch = useCallback(
    async (batchId: string) => {
      setRestoringBatchId(batchId)

      try {
        const response = await fetch(
          `/api/uploads/batches/${encodeURIComponent(batchId)}/restore`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
          },
        )
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null

        if (!response.ok) {
          throw new Error(payload?.error || 'Unable to restore upload batch.')
        }

        toast.success('Upload batch restored.')
        await refreshBatches()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Unable to restore upload batch.',
        )
      } finally {
        setRestoringBatchId(null)
      }
    },
    [refreshBatches],
  )

  const purgeBatch = useCallback(async () => {
    if (!batchPendingPurge || purgingBatchId) return
    const batchId = batchPendingPurge.id
    setPurgingBatchId(batchId)

    try {
      const response = await fetch(
        `/api/uploads/batches/${encodeURIComponent(batchId)}/purge`,
        { method: 'POST' },
      )
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to permanently delete batch.')
      }

      toast.success('Permanent deletion queued.')
      setBatchPendingPurge(null)
      await refreshBatches()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to permanently delete batch.',
      )
      await refreshBatches()
    } finally {
      setPurgingBatchId(null)
    }
  }, [batchPendingPurge, purgingBatchId, refreshBatches])

  useEffect(() => {
    void refreshBatches()
  }, [refreshBatches])

  useEffect(() => {
    if (
      !batches.some(
        (batch) =>
          batch.purgeStatus === 'queued' || batch.purgeStatus === 'running',
      )
    ) {
      return
    }

    const intervalId = window.setInterval(() => {
      void refreshBatches()
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [batches, refreshBatches])

  return (
    <AppShell
      title="Batches"
      subtitle="Organization-wide upload batch monitoring"
      pageHelp={{
        label: 'Guide me through this page',
        onStartTour: () => setTourStartSignal((current) => current + 1),
      }}
      tourTargets={{
        title: BATCHES_TOUR_TARGETS.title,
      }}
    >
      <div className="flex flex-col gap-4">
        {loadError ? (
          <Alert
            variant="destructive"
            className="rounded-md border-destructive/30 bg-destructive/5"
          >
            <IconAlertTriangle />
            <AlertTitle>Unable to load batches</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        <div
          className="grid gap-2 md:grid-cols-5"
          {...getProductTourTargetProps(BATCHES_TOUR_TARGETS.summary)}
        >
          <SummaryTile
            icon={IconStack2}
            label="Total"
            value={summary.total}
            description="Matching batches"
          />
          <SummaryTile
            icon={IconClockHour4}
            label="Active"
            value={summary.active}
            description="Open intake work"
          />
          <SummaryTile
            icon={IconAlertTriangle}
            label="Errors"
            value={summary.errors}
            description="Batches with errors"
          />
          <SummaryTile
            icon={IconCopy}
            label="Duplicates"
            value={summary.duplicates}
            description="Duplicate-only batches"
          />
          <SummaryTile
            icon={IconCircleCheck}
            label="Completed"
            value={summary.completed}
            description="Closed cleanly"
          />
        </div>

        <Card size="sm" className={PANEL_CARD_CLASS}>
          <CardHeader
            className={cn('gap-3 rounded-t-lg border-b', PANEL_BORDER_CLASS)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-sm">All batches</CardTitle>
                  <Badge variant="outline">
                    {pagination.totalItems.toLocaleString()} rows
                  </Badge>
                  {activeFilterCount > 0 ? (
                    <Badge variant="secondary">
                      {activeFilterCount} filters
                    </Badge>
                  ) : null}
                </div>
                <CardDescription className="text-xs">
                  Search and filter upload batches across the organization.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RefreshStatus
                  isRefreshing={isLoading}
                  lastUpdatedLabel={formatPageLastUpdated(lastRefreshedAt)}
                  refreshLabel="Refresh batches"
                  onRefresh={() => void refreshBatches()}
                />
              </div>
            </div>

            <FieldGroup
              className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1.4fr)_minmax(9rem,0.85fr)_minmax(10rem,0.95fr)_minmax(10rem,0.95fr)]"
              {...getProductTourTargetProps(BATCHES_TOUR_TARGETS.filters)}
            >
              <Field>
                <FieldLabel htmlFor="batch-search" className="text-xs">
                  Search
                </FieldLabel>
                <div className="relative min-w-0">
                  <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="batch-search"
                    value={batchSearchInput}
                    className="pl-9"
                    placeholder="Batch, ID, owner"
                    onChange={(event) =>
                      setBatchSearchInput(event.currentTarget.value)
                    }
                  />
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="batch-status" className="text-xs">
                  Status
                </FieldLabel>
                <Select
                  value={search.status || 'all'}
                  onValueChange={(value: string | null) =>
                    updateSearch({
                      status: value && value !== 'all' ? value : 'all',
                    })
                  }
                >
                  <SelectTrigger id="batch-status" className="w-full">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value="all">All statuses</SelectItem>
                      {filterOptions.statuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="batch-signing" className="text-xs">
                  Signing
                </FieldLabel>
                <Select
                  value={search.signingStatus}
                  onValueChange={(value: string | null) =>
                    updateSearch({
                      signingStatus:
                        value === 'unavailable' ||
                        value === 'unsigned' ||
                        value === 'partial' ||
                        value === 'signed'
                          ? value
                          : 'all',
                    })
                  }
                >
                  <SelectTrigger id="batch-signing" className="w-full">
                    <SelectValue placeholder="Signing" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value="all">All signing</SelectItem>
                      {filterOptions.signingStatuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {formatSigningStatus(status)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="batch-attention" className="text-xs">
                  Attention
                </FieldLabel>
                <Select
                  value={search.attention}
                  onValueChange={(value: string | null) =>
                    updateSearch({
                      attention:
                        value === 'needs_attention' || value === 'clear'
                          ? value
                          : 'all',
                    })
                  }
                >
                  <SelectTrigger id="batch-attention" className="w-full">
                    <SelectValue placeholder="Attention" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value="all">All attention</SelectItem>
                      <SelectItem value="needs_attention">
                        Needs attention
                      </SelectItem>
                      <SelectItem value="clear">No open attention</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>

            {hasActiveBatchFilters(search) ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    commitBatchSearchInput('', () =>
                      updateSearch({
                        q: '',
                        status: 'all',
                        entity: '',
                        signingStatus: 'all',
                        attention: 'all',
                      }),
                    )
                  }
                >
                  Clear filters
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Tabs
              value={search.repository}
              onValueChange={(value) =>
                updateSearch({
                  repository: value as BatchRepositoryFilter,
                  status: 'all',
                  signingStatus: 'all',
                  attention: 'all',
                })
              }
              className="gap-3"
            >
              <TabsList
                className={cn(
                  'w-full justify-start overflow-x-auto rounded-lg border p-1 sm:w-fit',
                  INSET_BORDER_CLASS,
                )}
                {...getProductTourTargetProps(
                  BATCHES_TOUR_TARGETS.repositoryTabs,
                )}
              >
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="deleted">Recently Deleted</TabsTrigger>
              </TabsList>
            </Tabs>
            <div {...getProductTourTargetProps(BATCHES_TOUR_TARGETS.table)}>
              <BatchesTable
                rows={batches}
                isLoading={isLoading}
                repository={search.repository}
                restoringBatchId={restoringBatchId}
                purgingBatchId={purgingBatchId}
                onRestoreBatch={(batchId) => void restoreBatch(batchId)}
                onRequestPurge={setBatchPendingPurge}
                emptyMessage={
                  isLoading
                    ? 'Loading batches...'
                    : search.repository === 'deleted'
                      ? 'No deleted batches.'
                      : 'No batches found.'
                }
              />
            </div>
            <div
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/15 px-3 py-2',
                INSET_BORDER_CLASS,
              )}
              {...getProductTourTargetProps(BATCHES_TOUR_TARGETS.pagination)}
            >
              <p className="text-sm text-muted-foreground">
                Showing {startRow}-{endRow} of{' '}
                {pagination.totalItems.toLocaleString()} rows
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={String(search.pageSize)}
                  onValueChange={(value: string | null) => {
                    if (value) {
                      updateSearch({ pageSize: Number.parseInt(value, 10) })
                    }
                  }}
                >
                  <SelectTrigger
                    aria-label="Rows per page"
                    size="sm"
                    className="w-28"
                  >
                    <SelectValue placeholder="Rows" />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectGroup>
                      {BATCH_PAGE_SIZE_OPTIONS.map((pageSize) => (
                        <SelectItem key={pageSize} value={String(pageSize)}>
                          {pageSize} rows
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
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
      </div>
      <BatchesTour startSignal={tourStartSignal} />
      <AlertDialog
        open={batchPendingPurge !== null}
        onOpenChange={(open) => {
          if (!open && !purgingBatchId) setBatchPendingPurge(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this batch?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every source PDF, extraction result,
              certificate record, and unsigned generated file in{' '}
              {batchPendingPurge
                ? `“${getBatchDisplayName(batchPendingPurge)}”`
                : 'this batch'}
              . This cannot be undone or restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(purgingBatchId)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={Boolean(purgingBatchId)}
              onClick={() => void purgeBatch()}
            >
              <IconTrash data-icon="inline-start" />
              {purgingBatchId ? 'Queuing...' : 'Delete permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}

function BatchesTable({
  rows,
  isLoading,
  repository,
  restoringBatchId,
  purgingBatchId,
  onRestoreBatch,
  onRequestPurge,
  emptyMessage,
}: {
  rows: Array<BatchListRow>
  isLoading: boolean
  repository: BatchRepositoryFilter
  restoringBatchId: string | null
  purgingBatchId: string | null
  onRestoreBatch: (batchId: string) => void
  onRequestPurge: (batch: BatchListRow) => void
  emptyMessage: string
}) {
  const navigate = useNavigate({ from: Route.fullPath })
  const isRepositoryView = repository === 'deleted'
  const openBatch = useCallback(
    (batchId: string) => {
      if (isRepositoryView) {
        return
      }

      void navigate({
        to: '/batches/$batchId',
        params: { batchId },
        search: DEFAULT_BATCH_DETAIL_ROUTE_SEARCH,
      })
    },
    [isRepositoryView, navigate],
  )

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-background',
        INSET_BORDER_CLASS,
      )}
    >
      <Table className="min-w-[920px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
        <TableHeader className="[&_tr]:border-border/60">
          <TableRow className="bg-muted/35 hover:bg-muted/35">
            <TableHead className="w-[18rem] bg-muted/35">Batch</TableHead>
            <TableHead className="bg-muted/35">Entity</TableHead>
            <TableHead className="bg-muted/35">Status</TableHead>
            <TableHead className="bg-muted/35 text-right">Files</TableHead>
            <TableHead className="bg-muted/35 text-right">Attention</TableHead>
            <TableHead className="bg-muted/35">Signing</TableHead>
            <TableHead className="bg-muted/35">Owner</TableHead>
            <TableHead className="bg-muted/35 text-right">Activity</TableHead>
            {isRepositoryView ? (
              <>
                <TableHead className="bg-muted/35 text-right">
                  Deleted
                </TableHead>
                <TableHead className="bg-muted/35 text-right">Purges</TableHead>
                <TableHead className="bg-muted/35 text-right">
                  Actions
                </TableHead>
              </>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr:last-child]:border-b-0">
          {isLoading && rows.length === 0
            ? Array.from({ length: 5 }, (_row, index) => (
                <TableRow key={index}>
                  {Array.from(
                    { length: isRepositoryView ? 11 : 8 },
                    (_cell, cellIndex) => (
                      <TableCell key={cellIndex}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ),
                  )}
                </TableRow>
              ))
            : rows.map((batch) => (
                <TableRow
                  key={batch.id}
                  tabIndex={isRepositoryView ? undefined : 0}
                  onClick={() => openBatch(batch.id)}
                  onKeyDown={(event) => {
                    if (isRepositoryView) {
                      return
                    }
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openBatch(batch.id)
                    }
                  }}
                  className={cn(
                    'border-border/60 bg-background hover:bg-muted/35',
                    isRepositoryView
                      ? undefined
                      : 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  )}
                  title={isRepositoryView ? undefined : 'Open batch detail'}
                >
                  <TableCell className="max-w-[18rem] align-top whitespace-normal">
                    <div className="flex min-w-0 flex-col gap-1">
                      {isRepositoryView ? (
                        <span className="truncate font-medium text-foreground">
                          {getBatchDisplayName(batch)}
                        </span>
                      ) : (
                        <Link
                          to="/batches/$batchId"
                          params={{ batchId: batch.id }}
                          search={DEFAULT_BATCH_DETAIL_ROUTE_SEARCH}
                          className="truncate font-medium text-foreground underline-offset-4 hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {getBatchDisplayName(batch)}
                        </Link>
                      )}
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {batch.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    {batch.entityName}
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusPill status={batch.overallStatus} />
                  </TableCell>
                  <TableCell className="text-right align-top font-medium">
                    {batch.totalFiles.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <Badge
                      variant={
                        batch.openAttentionCount > 0 ? 'outline' : 'secondary'
                      }
                    >
                      {batch.openAttentionCount.toLocaleString()}
                    </Badge>
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    {formatSigningStatus(batch.batchSigningStatus)}
                  </TableCell>
                  <TableCell className="max-w-[14rem] align-top text-muted-foreground">
                    <span className="block truncate">{batch.ownerName}</span>
                  </TableCell>
                  <TableCell className="text-right align-top text-muted-foreground">
                    {formatDateTime(batch.lastActivityAt)}
                  </TableCell>
                  {isRepositoryView ? (
                    <>
                      <TableCell className="text-right align-top text-muted-foreground">
                        {formatDateTime(batch.deletedAt)}
                      </TableCell>
                      <TableCell className="text-right align-top text-muted-foreground">
                        <div className="flex flex-col items-end gap-1">
                          <span>{formatDateTime(batch.purgeAfterAt)}</span>
                          {batch.purgeStatus ? (
                            <Badge
                              variant={
                                batch.purgeStatus === 'failed' ||
                                batch.purgeStatus === 'blocked'
                                  ? 'destructive'
                                  : batch.purgeStatus === 'scheduled'
                                    ? 'outline'
                                    : 'secondary'
                              }
                            >
                              {batch.purgeStatus === 'queued'
                                ? 'Deleting'
                                : batch.purgeStatus === 'running'
                                  ? 'Deleting'
                                  : batch.purgeStatus === 'failed'
                                    ? 'Delete failed'
                                    : batch.purgeStatus === 'blocked'
                                      ? 'Protected'
                                      : 'Scheduled'}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={
                              restoringBatchId === batch.id ||
                              batch.purgeStatus === 'queued' ||
                              batch.purgeStatus === 'running' ||
                              batch.purgeStatus === 'failed'
                            }
                            onClick={(event) => {
                              event.stopPropagation()
                              onRestoreBatch(batch.id)
                            }}
                          >
                            <IconRefresh data-icon="inline-start" />
                            {restoringBatchId === batch.id
                              ? 'Restoring...'
                              : 'Restore'}
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="destructive"
                            disabled={
                              purgingBatchId === batch.id ||
                              batch.purgeStatus === 'queued' ||
                              batch.purgeStatus === 'running' ||
                              batch.deletionEligibility?.canDelete === false
                            }
                            title={
                              batch.deletionEligibility?.canDelete === false
                                ? batch.deletionEligibility.reason
                                : undefined
                            }
                            onClick={(event) => {
                              event.stopPropagation()
                              onRequestPurge(batch)
                            }}
                          >
                            <IconTrash data-icon="inline-start" />
                            {purgingBatchId === batch.id
                              ? 'Queuing...'
                              : batch.purgeStatus === 'failed'
                                ? 'Retry delete'
                                : 'Delete now'}
                          </Button>
                        </div>
                        {batch.purgeError ? (
                          <p className="mt-1 max-w-64 text-right text-[11px] text-destructive">
                            {batch.purgeError}
                          </p>
                        ) : batch.deletionEligibility?.canDelete === false ? (
                          <p className="mt-1 max-w-64 text-right text-[11px] text-muted-foreground">
                            {batch.deletionEligibility.reason}
                          </p>
                        ) : null}
                      </TableCell>
                    </>
                  ) : null}
                </TableRow>
              ))}
          {!isLoading && rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={isRepositoryView ? 11 : 8}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}
