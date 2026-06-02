import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFileSpreadsheet,
  IconLoader2,
  IconRefresh,
  IconScale,
  IconSearch,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { FormEvent, ReactNode, RefObject } from 'react'

import type {
  BatchListPagination,
  BatchListResponse,
  BatchListRow,
} from '@/lib/upload-intake-types'
import type {
  SalesReportDetailView,
  SalesReportStatus,
  SalesReportVersionStatus,
} from '@/lib/sales-report-types'
import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import type { ReconciliationTableFilterValue } from '@/lib/reconciliation-table-state'
import type { SalesReportDetailRouteSearch } from '@/lib/sales-report-detail-search-state'
import { AppShell } from '@/components/app-shell'
import { ReconciliationResultsTable } from '@/components/reconciliation-results-table'
import {
  StatusPill,
  formatStatusLabel,
  statusToneStyles,
} from '@/components/status-pill'
import { defaultReconciliationSearch } from '@/lib/reconciliation-search-state'
import {
  buildSalesReportDetailQueryParams,
  parseSalesReportDetailSearch,
} from '@/lib/sales-report-detail-search-state'
import {
  reconciliationPageSizeOptions,
  reconciliationTableFilterOptions,
} from '@/lib/reconciliation-table-state'
import { getReconciliationCustomerEmailGroupKey } from '@/lib/reconciliation-customer-groups'
import { xhrPut } from '@/lib/upload-intake-client'
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
import { Checkbox } from '@/components/ui/checkbox'
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
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/reconciliation/reports/$reportId')({
  validateSearch: (search) => parseSalesReportDetailSearch(search),
  component: RouteComponent,
})

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const MAX_SELECTED_BATCHES = 100
const ELIGIBLE_BATCH_PAGE_SIZE = 25

const formatAmount = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : NUMBER_FORMATTER.format(value)

const formatDateTime = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '—'

function PanelPagination({
  pagination,
  itemLabel,
  onPrevious,
  onNext,
}: {
  pagination: BatchListPagination | null | undefined
  itemLabel: string
  onPrevious: () => void
  onNext: () => void
}) {
  if (!pagination) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        Page {pagination.page} of {pagination.totalPages}
        <span className="font-normal text-muted-foreground"> · </span>
        <span className="font-normal text-muted-foreground">
          {pagination.totalItems.toLocaleString()} {itemLabel}
        </span>
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!pagination.hasPreviousPage}
          onClick={onPrevious}
        >
          <IconChevronLeft data-icon="inline-start" />
          Previous
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!pagination.hasNextPage}
          onClick={onNext}
        >
          Next
          <IconChevronRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  detail,
  icon,
}: {
  label: string
  value: ReactNode
  detail?: string
  icon?: ReactNode
}) {
  return (
    <div className="flex min-h-20 items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      {icon ? (
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground [&_svg]:size-4">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-1 truncate text-base font-medium text-foreground">
          {value}
        </div>
        {detail ? (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function LoadingReportCard() {
  return (
    <Card size="sm" className="border border-border/70 shadow-sm">
      <CardHeader className="gap-3 border-b border-border/70">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </CardContent>
    </Card>
  )
}

function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
      {children}
    </div>
  )
}

function TableScroll({ children }: { children: ReactNode }) {
  return <div className="max-h-[360px] overflow-auto">{children}</div>
}

function StickyTableHeader({ children }: { children: ReactNode }) {
  return (
    <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:bg-muted/35 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
      {children}
    </TableHeader>
  )
}

function BatchPagination({
  pagination,
  onPrevious,
  onNext,
}: {
  pagination: BatchListPagination | null
  onPrevious: () => void
  onNext: () => void
}) {
  if (!pagination) return null

  return (
    <PanelPagination
      pagination={pagination}
      itemLabel="eligible batches"
      onPrevious={onPrevious}
      onNext={onNext}
    />
  )
}

function ResultsSummaryBadges({ report }: { report: SalesReportDetailView }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="outline" className={statusToneStyles.neutral}>
        {report.activeReconciliation.summary.totalRecords.toLocaleString()}{' '}
        total
      </Badge>
      <Badge variant="outline" className={statusToneStyles.success}>
        {report.activeReconciliation.summary.matched.toLocaleString()} matched
      </Badge>
      <Badge
        variant="outline"
        className={
          report.activeReconciliation.summary.unmatched > 0
            ? statusToneStyles.warning
            : statusToneStyles.success
        }
      >
        {report.activeReconciliation.summary.unmatched.toLocaleString()}{' '}
        unmatched
      </Badge>
    </div>
  )
}

function RowsSummaryBadge({ report }: { report: SalesReportDetailView }) {
  return (
    <Badge variant="outline" className={statusToneStyles.info}>
      {report.rowsPagination.totalItems.toLocaleString()} parsed rows
    </Badge>
  )
}

export const shouldShowSalesReportVersionStatus = (
  reportStatus: SalesReportStatus,
  versionStatus: SalesReportVersionStatus | null | undefined,
) =>
  Boolean(
    versionStatus &&
    formatStatusLabel(versionStatus) !== formatStatusLabel(reportStatus),
  )

function ReportIdentity({ report }: { report: SalesReportDetailView }) {
  const entityName =
    report.entity.shortName ??
    report.entity.companyName ??
    formatTinForDisplay(report.entity.tin)
  const versionStatus = report.currentVersion?.parseStatus
  const showVersionStatus = shouldShowSalesReportVersionStatus(
    report.status,
    versionStatus,
  )

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={report.status} />
        {showVersionStatus && versionStatus ? (
          <StatusPill status={versionStatus} />
        ) : null}
        <Badge variant="outline" className={statusToneStyles.info}>
          v{report.currentVersion?.versionNumber ?? 0}
        </Badge>
        <Badge variant="outline" className={statusToneStyles.neutral}>
          {entityName}
        </Badge>
      </div>
      <CardTitle className="mt-3 text-xl leading-tight">
        {report.name}
      </CardTitle>
      <CardDescription className="mt-2 truncate text-xs">
        {report.currentVersion?.originalFileName ?? 'No workbook uploaded'}
      </CardDescription>
    </div>
  )
}

function ReportActions({
  report,
  isLoading,
  isUploading,
  inputRef,
  onRefresh,
  onDelete,
}: {
  report: SalesReportDetailView
  isLoading: boolean
  isUploading: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onRefresh: () => void
  onDelete: () => void
}) {
  return (
    <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-[28rem]">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
      >
        {isUploading ? (
          <IconLoader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <IconUpload data-icon="inline-start" />
        )}
        {isUploading ? 'Updating...' : 'Update file'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        render={
          <a href={`/api/sales-reports/${report.id}?download=original`} />
        }
      >
        <IconDownload data-icon="inline-start" />
        Download
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRefresh}
        disabled={isLoading}
      >
        <IconRefresh data-icon="inline-start" />
        Refresh
      </Button>
      <AlertDialog>
        <AlertDialogTrigger
          render={<Button type="button" size="sm" variant="destructive" />}
        >
          <IconTrash data-icon="inline-start" />
          Delete
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete sales report?</AlertDialogTitle>
            <AlertDialogDescription>
              This archives the report and its active reconciliation results.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function DetailStatGrid({ report }: { report: SalesReportDetailView }) {
  const version = report.currentVersion

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <MetricTile
        label="Rows parsed"
        value={(version?.rowCount ?? 0).toLocaleString()}
        detail={version?.parseStatus ?? 'No version'}
        icon={<IconFileSpreadsheet />}
      />
      <MetricTile
        label="Matched"
        value={report.activeReconciliation.summary.matched.toLocaleString()}
        detail={`${report.activeReconciliation.summary.unmatched.toLocaleString()} unmatched`}
        icon={<IconCheck />}
      />
      <MetricTile
        label="Variance"
        value={formatAmount(report.activeReconciliation.summary.varianceTotal)}
        detail="Absolute tax base and withheld"
        icon={<IconScale />}
      />
      <MetricTile
        label="Updated"
        value={formatDateTime(report.updatedAt)}
        detail={version ? `v${version.versionNumber}` : undefined}
      />
    </div>
  )
}

function ReportNameEditor({
  nameInput,
  isSavingName,
  onChange,
  onSave,
}: {
  nameInput: string
  isSavingName: boolean
  onChange: (value: string) => void
  onSave: () => void
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="sales-report-name">Report name</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="sales-report-name"
            value={nameInput}
            onChange={(event) => onChange(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={isSavingName || !nameInput.trim()}
            onClick={onSave}
          >
            Save
          </Button>
        </div>
      </Field>
    </FieldGroup>
  )
}

function RouteComponent() {
  const { reportId } = Route.useParams()
  const search = Route.useSearch()
  const {
    q: resultsQuery,
    filter: resultsFilter,
    page: resultsPage,
    pageSize: resultsPageSize,
    rowsQ: parsedRowsQuery,
    rowsPage,
    rowsPageSize,
  } = search
  const navigate = useNavigate({ from: Route.fullPath })
  const inputRef = useRef<HTMLInputElement | null>(null)
  const reportRequestIdRef = useRef(0)
  const [report, setReport] = useState<SalesReportDetailView | null>(null)
  const [eligibleBatches, setEligibleBatches] = useState<Array<BatchListRow>>(
    [],
  )
  const [eligibleBatchPagination, setEligibleBatchPagination] =
    useState<BatchListPagination | null>(null)
  const [batchSearchInput, setBatchSearchInput] = useState('')
  const [batchQuery, setBatchQuery] = useState('')
  const [batchPage, setBatchPage] = useState(1)
  const [selectedBatchIds, setSelectedBatchIds] = useState<Array<string>>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isSavingName, setIsSavingName] = useState(false)
  const [emailingCustomerGroupKey, setEmailingCustomerGroupKey] = useState<
    string | null
  >(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const latestRun = report?.runs.at(0) ?? null
  const selectedBatchIdSet = useMemo(
    () => new Set(selectedBatchIds),
    [selectedBatchIds],
  )
  const currentSearch = useMemo<SalesReportDetailRouteSearch>(
    () => ({
      q: resultsQuery,
      filter: resultsFilter,
      page: resultsPage,
      pageSize: resultsPageSize,
      rowsQ: parsedRowsQuery,
      rowsPage,
      rowsPageSize,
    }),
    [
      parsedRowsQuery,
      resultsFilter,
      resultsPage,
      resultsPageSize,
      resultsQuery,
      rowsPage,
      rowsPageSize,
    ],
  )
  const hasParsedRowSearch = Boolean(parsedRowsQuery)
  const hasResultFilters = Boolean(resultsQuery || resultsFilter !== 'all')

  const updateResultSearch = useCallback(
    (
      patch: Partial<SalesReportDetailRouteSearch>,
      options: { resetPage?: boolean } = { resetPage: true },
    ) => {
      void navigate({
        search: (previous) =>
          parseSalesReportDetailSearch({
            ...previous,
            ...patch,
            page:
              options.resetPage === false ? (patch.page ?? previous.page) : 1,
          }),
        replace: true,
      })
    },
    [navigate],
  )

  const updateParsedRowsSearch = useCallback(
    (
      patch: Partial<SalesReportDetailRouteSearch>,
      options: { resetPage?: boolean } = { resetPage: true },
    ) => {
      void navigate({
        search: (previous) =>
          parseSalesReportDetailSearch({
            ...previous,
            ...patch,
            rowsPage:
              options.resetPage === false
                ? (patch.rowsPage ?? previous.rowsPage)
                : 1,
          }),
        replace: true,
      })
    },
    [navigate],
  )

  const refreshReport = useCallback(
    async (requestedSearch: SalesReportDetailRouteSearch = currentSearch) => {
      const requestId = reportRequestIdRef.current + 1
      reportRequestIdRef.current = requestId
      setIsLoading(true)
      try {
        const params = buildSalesReportDetailQueryParams(requestedSearch)
        const response = await fetch(
          `/api/sales-reports/${encodeURIComponent(reportId)}?${params.toString()}`,
          { cache: 'no-store' },
        )
        const payload = (await response.json().catch(() => null)) as {
          report?: SalesReportDetailView
          error?: string
        } | null

        if (!response.ok || !payload?.report) {
          throw new Error(
            payload?.error ||
              `Failed to load sales report (${response.status}).`,
          )
        }

        if (requestId !== reportRequestIdRef.current) return

        setReport(payload.report)
        setNameInput(payload.report.name)
        setLoadError(null)
      } catch (error) {
        if (requestId !== reportRequestIdRef.current) return
        setReport(null)
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to load sales report.',
        )
      } finally {
        if (requestId === reportRequestIdRef.current) {
          setIsLoading(false)
        }
      }
    },
    [currentSearch, reportId],
  )

  const refreshEligibleBatches = useCallback(
    async (entityId: number, page: number, query: string) => {
      const params = new URLSearchParams({
        entityId: String(entityId),
        page: String(page),
        pageSize: String(ELIGIBLE_BATCH_PAGE_SIZE),
        reconciliationEligible: 'true',
      })
      const normalizedQuery = query.trim()
      if (normalizedQuery) params.set('q', normalizedQuery)

      const response = await fetch(
        `/api/uploads/batches?${params.toString()}`,
        {
          cache: 'no-store',
        },
      )
      const payload = (await response.json().catch(() => null)) as
        | (BatchListResponse & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to load batches (${response.status}).`,
        )
      }

      setEligibleBatches(payload?.batches ?? [])
      setEligibleBatchPagination(payload?.pagination ?? null)
    },
    [],
  )

  useEffect(() => {
    void refreshReport()
  }, [refreshReport])

  useEffect(() => {
    setBatchPage(1)
    setBatchQuery('')
    setBatchSearchInput('')
    setSelectedBatchIds([])
  }, [reportId])

  const submitBatchSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setBatchPage(1)
      setBatchQuery(batchSearchInput)
    },
    [batchSearchInput],
  )

  const clearBatchSearch = useCallback(() => {
    setBatchSearchInput('')
    setBatchQuery('')
    setBatchPage(1)
  }, [])

  const toggleBatchSelection = useCallback(
    (batchId: string, checked: boolean) => {
      setSelectedBatchIds((current) => {
        if (!checked) return current.filter((id) => id !== batchId)
        if (current.includes(batchId)) return current
        if (current.length >= MAX_SELECTED_BATCHES) {
          toast.error(`Select ${MAX_SELECTED_BATCHES} batches or fewer.`)
          return current
        }
        return [...current, batchId]
      })
    },
    [],
  )

  useEffect(() => {
    if (!report || !eligibleBatchPagination) return
    if (
      eligibleBatchPagination.totalPages > 0 &&
      batchPage > eligibleBatchPagination.totalPages
    ) {
      setBatchPage(eligibleBatchPagination.totalPages)
    }
  }, [batchPage, eligibleBatchPagination, report])

  useEffect(() => {
    if (!report) return
    const { rowsPagination } = report
    if (rowsPagination.totalPages > 0 && rowsPage > rowsPagination.totalPages) {
      updateParsedRowsSearch(
        { rowsPage: rowsPagination.totalPages },
        { resetPage: false },
      )
    }
  }, [report, rowsPage, updateParsedRowsSearch])

  useEffect(() => {
    if (!report?.activeReconciliation.pagination) return
    const { pagination } = report.activeReconciliation
    if (pagination.totalPages > 0 && resultsPage > pagination.totalPages) {
      updateResultSearch({ page: pagination.totalPages }, { resetPage: false })
    }
  }, [report, resultsPage, updateResultSearch])

  useEffect(() => {
    if (!report) return
    void refreshEligibleBatches(report.entity.id, batchPage, batchQuery).catch(
      (error) => {
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to load eligible batches.',
        )
      },
    )
  }, [batchPage, batchQuery, refreshEligibleBatches, report])

  const handleUpdateFile = useCallback(
    async (file: File | null) => {
      if (!file || !report) return
      setIsUploading(true)
      try {
        const presignResponse = await fetch('/api/sales-reports/presign', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            reportId: report.id,
            entityId: report.entity.id,
            name: report.name,
            file: {
              name: file.name,
              type:
                file.type ||
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              size: file.size,
            },
          }),
        })
        const presignPayload = (await presignResponse
          .json()
          .catch(() => null)) as {
          upload?: {
            reportId: string
            versionId: string
            url: string
            headers: Record<string, string>
          }
          error?: string
        } | null

        if (!presignResponse.ok || !presignPayload?.upload) {
          throw new Error(
            presignPayload?.error ||
              `Failed to prepare update (${presignResponse.status}).`,
          )
        }

        await xhrPut(
          presignPayload.upload.url,
          file,
          presignPayload.upload.headers,
          () => undefined,
        )

        const completeResponse = await fetch('/api/sales-reports/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            reportId: presignPayload.upload.reportId,
            versionId: presignPayload.upload.versionId,
          }),
        })
        const completePayload = (await completeResponse
          .json()
          .catch(() => null)) as { error?: string } | null

        if (!completeResponse.ok) {
          throw new Error(
            completePayload?.error ||
              `Failed to process update (${completeResponse.status}).`,
          )
        }

        const resetSearch = parseSalesReportDetailSearch({
          ...currentSearch,
          rowsPage: 1,
          page: 1,
        })
        void navigate({ search: resetSearch, replace: true })
        await refreshReport(resetSearch)
        toast.success('Sales report updated.')
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Unable to update sales report.',
        )
      } finally {
        setIsUploading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [currentSearch, navigate, refreshReport, report],
  )

  const saveName = useCallback(async () => {
    if (!report || nameInput.trim() === report.name) return
    setIsSavingName(true)
    try {
      const response = await fetch(`/api/sales-reports/${report.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nameInput.trim() }),
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to rename sales report (${response.status}).`,
        )
      }

      await refreshReport()
      toast.success('Sales report renamed.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to rename sales report.',
      )
    } finally {
      setIsSavingName(false)
    }
  }, [nameInput, refreshReport, report])

  const deleteReport = useCallback(async () => {
    if (!report) return
    const response = await fetch(`/api/sales-reports/${report.id}`, {
      method: 'DELETE',
    })
    const payload = (await response.json().catch(() => null)) as {
      error?: string
    } | null

    if (!response.ok) {
      throw new Error(
        payload?.error || `Failed to delete sales report (${response.status}).`,
      )
    }

    toast.success('Sales report deleted.')
    void navigate({
      to: '/reconciliation',
      search: defaultReconciliationSearch,
    })
  }, [navigate, report])

  const runReconciliation = useCallback(async () => {
    if (!report || selectedBatchIds.length === 0) return
    setIsRunning(true)
    try {
      const response = await fetch(
        `/api/sales-reports/${report.id}/reconcile`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ batchIds: selectedBatchIds }),
        },
      )
      const payload = (await response.json().catch(() => null)) as {
        report?: SalesReportDetailView
        error?: string
      } | null

      if (!response.ok || !payload?.report) {
        throw new Error(
          payload?.error ||
            `Failed to run reconciliation (${response.status}).`,
        )
      }

      const resetSearch = parseSalesReportDetailSearch({
        ...currentSearch,
        page: 1,
      })
      void navigate({ search: resetSearch, replace: true })
      await refreshReport(resetSearch)
      toast.success('Reconciliation complete.', {
        description: `${payload.report.activeReconciliation.summary.matched.toLocaleString()} rows matched.`,
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to run reconciliation.',
      )
    } finally {
      setIsRunning(false)
    }
  }, [currentSearch, navigate, refreshReport, report, selectedBatchIds])

  const handleSendEmail = useCallback(
    async (row: ReconciliationRowView) => {
      setEmailingCustomerGroupKey(getReconciliationCustomerEmailGroupKey(row))
      setEmailError(null)
      try {
        const response = await fetch(`/api/reconciliation/${row.id}`, {
          method: 'POST',
        })
        const payload = (await response.json().catch(() => null)) as {
          message?: string
          error?: string
        } | null

        if (!response.ok) {
          throw new Error(
            payload?.error ||
              `Failed to send reconciliation email (${response.status}).`,
          )
        }

        await refreshReport()
        toast.success('Email sent successfully', {
          description:
            payload?.message || `Email sent for ${row.customerName}.`,
        })
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to send reconciliation email.'

        setEmailError(message)
        toast.error('Unable to send reconciliation email.', {
          description: message,
        })
      } finally {
        setEmailingCustomerGroupKey(null)
      }
    },
    [refreshReport],
  )

  return (
    <AppShell
      title="Sales Report"
      subtitle="Review parsed rows, select batches, and run reconciliation"
      leadingActions={
        <Button
          type="button"
          size="sm"
          variant="outline"
          render={
            <Link to="/reconciliation" search={defaultReconciliationSearch} />
          }
        >
          <IconArrowLeft data-icon="inline-start" />
          Back
        </Button>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(event) => {
          void handleUpdateFile(event.target.files?.item(0) ?? null)
        }}
      />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        {loadError ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertTitle>Unable to load sales report</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}
        {emailError ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertTitle>Unable to send email</AlertTitle>
            <AlertDescription>{emailError}</AlertDescription>
          </Alert>
        ) : null}

        {!report && isLoading ? <LoadingReportCard /> : null}

        {report ? (
          <>
            <Card size="sm" className="border border-border/70 shadow-sm">
              <CardHeader className="gap-4 border-b border-border/70">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <ReportIdentity report={report} />
                  <ReportActions
                    report={report}
                    isLoading={isLoading}
                    isUploading={isUploading}
                    inputRef={inputRef}
                    onRefresh={() => void refreshReport()}
                    onDelete={() => void deleteReport()}
                  />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <DetailStatGrid report={report} />
                <ReportNameEditor
                  nameInput={nameInput}
                  isSavingName={isSavingName}
                  onChange={setNameInput}
                  onSave={() => void saveName()}
                />
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <Card size="sm" className="border border-border/70 shadow-sm">
                <CardHeader className="gap-3 border-b border-border/70">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm">Select batches</CardTitle>
                      <CardDescription className="text-xs">
                        Eligible closed batches from the same entity with
                        completed extraction results.
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {selectedBatchIds.length}/{MAX_SELECTED_BATCHES}{' '}
                        selected
                      </span>
                      {selectedBatchIds.length > 0 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedBatchIds([])}
                        >
                          Clear
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        disabled={selectedBatchIds.length === 0 || isRunning}
                        onClick={() => void runReconciliation()}
                      >
                        {isRunning ? (
                          <IconLoader2
                            data-icon="inline-start"
                            className="animate-spin"
                          />
                        ) : (
                          <IconCheck data-icon="inline-start" />
                        )}
                        {isRunning ? 'Running...' : 'Run reconciliation'}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={submitBatchSearch}
                  >
                    <div className="relative flex-1">
                      <IconSearch
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        className="pl-9"
                        value={batchSearchInput}
                        onChange={(event) =>
                          setBatchSearchInput(event.target.value)
                        }
                        placeholder="Search batch name, id, owner, or entity"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" variant="outline">
                        Search
                      </Button>
                      {batchQuery ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={clearBatchSearch}
                        >
                          Reset
                        </Button>
                      ) : null}
                    </div>
                  </form>
                  {eligibleBatches.length === 0 ? (
                    <EmptyPanel>
                      No eligible closed batches found for this entity.
                    </EmptyPanel>
                  ) : (
                    <div className="flex max-h-[28rem] flex-col gap-2 overflow-auto pr-1">
                      {eligibleBatches.map((batch) => {
                        const isSelected = selectedBatchIdSet.has(batch.id)

                        return (
                          <label
                            key={batch.id}
                            className={cn(
                              'flex cursor-pointer items-center gap-3 rounded-lg border border-border/70 bg-background p-3 transition-colors hover:bg-muted/30',
                              isSelected && 'border-primary/40 bg-muted/30',
                            )}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                toggleBatchSelection(batch.id, checked === true)
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {batch.name ?? batch.id}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {batch.totalFiles.toLocaleString()} files ·
                                closed {formatDateTime(batch.closedAt)}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={statusToneStyles.success}
                            >
                              {batch.counts.success} ready
                            </Badge>
                          </label>
                        )
                      })}
                    </div>
                  )}
                  <BatchPagination
                    pagination={eligibleBatchPagination}
                    onPrevious={() =>
                      setBatchPage((current) => Math.max(1, current - 1))
                    }
                    onNext={() => setBatchPage((current) => current + 1)}
                  />
                </CardContent>
              </Card>

              <Card size="sm" className="border border-border/70 shadow-sm">
                <CardHeader className="gap-3 border-b border-border/70">
                  <CardTitle className="text-sm">Run status</CardTitle>
                  <CardDescription className="text-xs">
                    Latest explicit reconciliation run for this report.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <MetricTile
                    label="Status"
                    value={
                      latestRun
                        ? formatStatusLabel(latestRun.status)
                        : 'Not run'
                    }
                    detail={
                      latestRun ? formatDateTime(latestRun.startedAt) : ''
                    }
                  />
                  <MetricTile
                    label="Batches"
                    value={latestRun?.selectedBatchCount ?? 0}
                    detail="Selected in latest run"
                  />
                  <MetricTile
                    label="Matched"
                    value={report.activeReconciliation.summary.matched.toLocaleString()}
                    detail={`${report.activeReconciliation.summary.totalRecords.toLocaleString()} active rows`}
                  />
                  <MetricTile
                    label="Variance"
                    value={formatAmount(
                      report.activeReconciliation.summary.varianceTotal,
                    )}
                    detail="Current active results"
                  />
                </CardContent>
              </Card>
            </div>

            <Card size="sm" className="border border-border/70 shadow-sm">
              <CardHeader className="gap-3 border-b border-border/70">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm">Parsed sales rows</CardTitle>
                    <CardDescription className="text-xs">
                      Normalized rows from the active sales report version.
                    </CardDescription>
                  </div>
                  <RowsSummaryBadge report={report} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <FieldGroup className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,180px)_auto] lg:items-end">
                    <Field>
                      <FieldLabel htmlFor="sales-report-rows-search">
                        Search
                      </FieldLabel>
                      <div className="relative">
                        <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="sales-report-rows-search"
                          className="pl-9"
                          value={parsedRowsQuery}
                          onChange={(event) =>
                            updateParsedRowsSearch({
                              rowsQ: event.target.value,
                            })
                          }
                          placeholder="Search customer, TIN, invoice, row, or billing month"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sales-report-rows-page-size">
                        Rows per page
                      </FieldLabel>
                      <Select
                        value={String(rowsPageSize)}
                        onValueChange={(value: string | null) => {
                          if (value) {
                            updateParsedRowsSearch({
                              rowsPageSize: Number(value),
                            })
                          }
                        }}
                      >
                        <SelectTrigger id="sales-report-rows-page-size">
                          <SelectValue placeholder="Rows per page" />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectGroup>
                            {reconciliationPageSizeOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    {hasParsedRowSearch ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => updateParsedRowsSearch({ rowsQ: '' })}
                      >
                        Clear
                      </Button>
                    ) : null}
                  </FieldGroup>
                </div>
                <TableShell>
                  <TableScroll>
                    <Table>
                      <StickyTableHeader>
                        <TableRow>
                          <TableHead>Row</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>TIN</TableHead>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Billing</TableHead>
                          <TableHead className="text-right">
                            Taxable sales
                          </TableHead>
                          <TableHead className="text-right">
                            Prepaid CWT
                          </TableHead>
                        </TableRow>
                      </StickyTableHeader>
                      <TableBody>
                        {report.rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7}>
                              <EmptyPanel>
                                {hasParsedRowSearch
                                  ? 'No parsed sales rows match the current search.'
                                  : 'No parsed sales rows found.'}
                              </EmptyPanel>
                            </TableCell>
                          </TableRow>
                        ) : (
                          report.rows.map((row) => (
                            <TableRow
                              key={row.id}
                              className="transition-colors hover:bg-muted/30"
                            >
                              <TableCell className="font-medium">
                                {row.rowNumber}
                              </TableCell>
                              <TableCell className="max-w-64 truncate font-medium">
                                {row.customerName}
                              </TableCell>
                              <TableCell>
                                {formatTinForDisplay(row.tin) || '—'}
                              </TableCell>
                              <TableCell>{row.invoiceNumber}</TableCell>
                              <TableCell>
                                {row.derivedBillingMonthMMYY}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatAmount(row.taxableSales)}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatAmount(row.prepaidCWT)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </TableScroll>
                </TableShell>
                <PanelPagination
                  pagination={report.rowsPagination}
                  itemLabel="rows"
                  onPrevious={() =>
                    updateParsedRowsSearch(
                      {
                        rowsPage: Math.max(report.rowsPagination.page - 1, 1),
                      },
                      { resetPage: false },
                    )
                  }
                  onNext={() =>
                    updateParsedRowsSearch(
                      {
                        rowsPage: Math.min(
                          report.rowsPagination.page + 1,
                          report.rowsPagination.totalPages,
                        ),
                      },
                      { resetPage: false },
                    )
                  }
                />
              </CardContent>
            </Card>

            <Card size="sm" className="border border-border/70 shadow-sm">
              <CardHeader className="gap-3 border-b border-border/70">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm">
                      Active reconciliation results
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Current non-archived results generated by this report.
                    </CardDescription>
                  </div>
                  <ResultsSummaryBadges report={report} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <FieldGroup className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,220px)_minmax(0,180px)_auto] xl:items-end">
                    <Field>
                      <FieldLabel htmlFor="sales-report-results-search">
                        Search
                      </FieldLabel>
                      <div className="relative">
                        <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="sales-report-results-search"
                          className="pl-9"
                          value={resultsQuery}
                          onChange={(event) =>
                            updateResultSearch({ q: event.target.value })
                          }
                          placeholder="Search customer, TIN, invoice, or transaction line"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sales-report-results-filter">
                        Filter
                      </FieldLabel>
                      <Select
                        value={resultsFilter}
                        onValueChange={(value: string | null) => {
                          if (value) {
                            updateResultSearch({
                              filter: value as ReconciliationTableFilterValue,
                            })
                          }
                        }}
                      >
                        <SelectTrigger id="sales-report-results-filter">
                          <SelectValue placeholder="Filter results" />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectGroup>
                            {reconciliationTableFilterOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sales-report-results-page-size">
                        Rows per page
                      </FieldLabel>
                      <Select
                        value={String(resultsPageSize)}
                        onValueChange={(value: string | null) => {
                          if (value) {
                            updateResultSearch({ pageSize: Number(value) })
                          }
                        }}
                      >
                        <SelectTrigger id="sales-report-results-page-size">
                          <SelectValue placeholder="Rows per page" />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectGroup>
                            {reconciliationPageSizeOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    {hasResultFilters ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          updateResultSearch({ q: '', filter: 'all' })
                        }
                      >
                        Clear
                      </Button>
                    ) : null}
                  </FieldGroup>
                </div>
                <ReconciliationResultsTable
                  rows={report.activeReconciliation.rows}
                  density="compact"
                  emailingCustomerGroupKey={emailingCustomerGroupKey}
                  emptyMessage={
                    hasResultFilters
                      ? 'No reconciliation results match the current filters.'
                      : 'No reconciliation results yet.'
                  }
                  emptyDescription={
                    hasResultFilters
                      ? 'Adjust the search or filter to widen this result set.'
                      : 'Select one or more batches and run reconciliation.'
                  }
                  onEmailRow={(row) => void handleSendEmail(row)}
                />
                <PanelPagination
                  pagination={report.activeReconciliation.pagination}
                  itemLabel="results"
                  onPrevious={() =>
                    updateResultSearch(
                      {
                        page: Math.max(
                          (report.activeReconciliation.pagination?.page ??
                            resultsPage) - 1,
                          1,
                        ),
                      },
                      { resetPage: false },
                    )
                  }
                  onNext={() =>
                    updateResultSearch(
                      {
                        page: Math.min(
                          (report.activeReconciliation.pagination?.page ??
                            resultsPage) + 1,
                          report.activeReconciliation.pagination?.totalPages ??
                            resultsPage,
                        ),
                      },
                      { resetPage: false },
                    )
                  }
                />
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </AppShell>
  )
}
