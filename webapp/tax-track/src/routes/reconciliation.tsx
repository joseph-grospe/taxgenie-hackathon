import {
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import {
  IconAlertCircle,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconLoader2,
  IconPlus,
  IconReceipt2,
  IconScale,
  IconSearch,
} from '@tabler/icons-react'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Icon } from '@tabler/icons-react'
import type { KeyboardEvent } from 'react'

import type {
  ReconciliationListView,
  ReconciliationRowView,
} from '@/lib/reconciliation-types'
import type { ReconciliationTableFilterValue } from '@/lib/reconciliation-table-state'
import type {
  SalesReportListItem,
  SalesReportListResponse,
} from '@/lib/sales-report-types'
import type { ReconciliationExportGranularity } from '@/lib/reconciliation-report'
import { AppShell } from '@/components/app-shell'
import { ReconciliationTour } from '@/components/product-tour'
import { ReconciliationDetailDrawer } from '@/components/reconciliation-detail-drawer'
import { ReconciliationResultsTable } from '@/components/reconciliation-results-table'
import { StatusPill, statusToneStyles } from '@/components/status-pill'
import { authClient } from '@/lib/auth-client'
import {
  canExport,
  isAdmin,
  isEditor,
  parseSessionContext,
} from '@/lib/access-control'
import { useEntityScope } from '@/components/entity-scope-provider'
import {
  buildReconciliationQueryParams,
  defaultReconciliationSearch,
  parseReconciliationSearch,
} from '@/lib/reconciliation-search-state'
import { defaultSalesReportDetailSearch } from '@/lib/sales-report-detail-search-state'
import {
  countPendingReconciliationCustomerEmailGroups,
  getReconciliationCustomerEmailGroupKey,
} from '@/lib/reconciliation-customer-groups'
import {
  getAnnualExportOptions,
  getMonthlyExportOptions,
  getQuarterlyExportOptions,
} from '@/lib/reconciliation-report'
import {
  reconciliationPageSizeOptions,
  reconciliationTableFilterOptions,
} from '@/lib/reconciliation-table-state'
import {
  RECONCILIATION_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { createManilaDateFormatter } from '@/lib/manila-time'
import { xhrPut } from '@/lib/upload-intake-client'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const Route = createFileRoute('/reconciliation')({
  validateSearch: (search) => parseReconciliationSearch(search),
  component: RouteComponent,
})

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const EMPTY_RECONCILIATION_PAGINATION = {
  page: defaultReconciliationSearch.page,
  pageSize: defaultReconciliationSearch.pageSize,
  totalItems: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

const EMPTY_RECONCILIATION: ReconciliationListView = {
  rows: [],
  summary: {
    totalRecords: 0,
    matched: 0,
    unmatched: 0,
    varianceTotal: 0,
  },
  pagination: EMPTY_RECONCILIATION_PAGINATION,
}

const SALES_REPORT_PAGE_SIZE = 25

const EMPTY_REPORTS: SalesReportListResponse = {
  reports: [],
  pagination: {
    page: 1,
    pageSize: SALES_REPORT_PAGE_SIZE,
    totalItems: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  summary: {
    total: 0,
    ready: 0,
    error: 0,
    uploading: 0,
  },
}

const formatAmount = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : NUMBER_FORMATTER.format(value)

const DATE_TIME_FORMATTER = createManilaDateFormatter('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const formatDateTime = (value: string | null | undefined) =>
  value ? DATE_TIME_FORMATTER.format(new Date(value)) : '—'

function StatusBanner({
  tone,
  children,
}: {
  tone: 'danger' | 'success'
  children: string
}) {
  return (
    <Alert variant={tone === 'danger' ? 'destructive' : 'default'}>
      {tone === 'danger' ? <IconAlertCircle /> : <IconCheck />}
      <AlertTitle>{tone === 'danger' ? 'Action needed' : 'Ready'}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}

function SummaryMetricCard({
  icon: IconComponent,
  label,
  value,
  description,
}: {
  icon: Icon
  label: string
  value: string | number
  description: string
}) {
  return (
    <Card size="sm" className="border border-border/70">
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <IconComponent className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold leading-none">{value}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function PaginationBar({
  pagination,
  itemLabel,
  onPrevious,
  onNext,
}: {
  pagination: SalesReportListResponse['pagination']
  itemLabel: string
  onPrevious: () => void
  onNext: () => void
}) {
  if (pagination.totalItems === 0) return null

  const start =
    pagination.totalItems === 0
      ? 0
      : (pagination.page - 1) * pagination.pageSize + 1
  const end =
    pagination.totalItems === 0
      ? 0
      : Math.min(pagination.page * pagination.pageSize, pagination.totalItems)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        Showing {start}-{end} of {pagination.totalItems.toLocaleString()}{' '}
        {itemLabel}
      </span>
      <div className="flex items-center gap-2">
        <span>
          Page {pagination.page} of {pagination.totalPages}
        </span>
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

function SalesReportTable({
  reports,
  isLoading,
  onOpenReport,
}: {
  reports: Array<SalesReportListItem>
  isLoading: boolean
  onOpenReport: (reportId: string) => void
}) {
  const handleReportRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    reportId: string,
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    onOpenReport(reportId)
  }

  if (reports.length === 0) {
    return (
      <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 bg-muted/10 p-6 text-center">
        <p className="text-sm font-medium">
          {isLoading ? 'Loading sales reports...' : 'No sales reports yet.'}
        </p>
        <p className="max-w-md text-xs leading-5 text-muted-foreground">
          Upload a sales report for the selected entity, then open it to choose
          batches and run reconciliation.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
      <div className="max-h-[360px] overflow-auto">
        <Table className="text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2">
          <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:h-8 [&_th]:bg-muted/35 [&_th]:text-[0.64rem] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-normal [&_th]:text-muted-foreground">
            <TableRow>
              <TableHead>Sales report</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead>Latest run</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((report) => (
              <TableRow
                key={report.id}
                role="link"
                tabIndex={0}
                aria-label={`Open sales report ${report.name}`}
                className="cursor-pointer odd:bg-muted/10 outline-none transition-colors hover:bg-muted/35 focus-visible:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => onOpenReport(report.id)}
                onKeyDown={(event) => handleReportRowKeyDown(event, report.id)}
              >
                <TableCell>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">{report.name}</span>
                    <span className="max-w-64 truncate text-muted-foreground">
                      {report.currentVersion?.originalFileName ?? 'No file'}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="block max-w-40 truncate">
                    {report.entity.shortName ??
                      report.entity.companyName ??
                      formatTinForDisplay(report.entity.tin)}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusPill status={report.status} />
                </TableCell>
                <TableCell className="text-right">
                  {report.currentVersion?.rowCount.toLocaleString() ?? '—'}
                </TableCell>
                <TableCell>
                  {report.latestRun ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusPill
                        status={report.latestRun.status}
                        className="w-fit shrink-0"
                      />
                      <span className="font-medium">
                        {report.latestRun.matchedCount.toLocaleString()} matched
                      </span>
                      <span className="text-muted-foreground">
                        {report.latestRun.selectedBatchCount} batches
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(report.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function RouteComponent() {
  const { data: session } = authClient.useSession()
  const context = session?.user ? parseSessionContext(session.user) : null
  const canExportSheet = context
    ? canExport.excel(context.role, context.canExportExcel)
    : false
  const canSendReconciliationEmail = context
    ? isAdmin(context.role) || isEditor(context.role)
    : false
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isChildRoute =
    pathname !== '/reconciliation' && pathname.startsWith('/reconciliation/')
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { selectedEntity, ensureEntitiesLoaded } = useEntityScope()
  const [reports, setReports] = useState<SalesReportListResponse>(EMPTY_REPORTS)
  const [reconciliation, setReconciliation] =
    useState<ReconciliationListView>(EMPTY_RECONCILIATION)
  const [isLoadingReports, setIsLoadingReports] = useState(false)
  const [isLoadingRows, setIsLoadingRows] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reportPage, setReportPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [emailingCustomerGroupKey, setEmailingCustomerGroupKey] = useState<
    string | null
  >(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [exportGranularity, setExportGranularity] =
    useState<ReconciliationExportGranularity>('monthly')
  const [selectedExportPeriod, setSelectedExportPeriod] = useState('')
  const [exportCustomerName, setExportCustomerName] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [tourStartSignal, setTourStartSignal] = useState(0)

  const selectedRow = useMemo(
    () =>
      reconciliation.rows.find((row) => row.id === selectedId) ??
      reconciliation.rows.at(0) ??
      null,
    [reconciliation.rows, selectedId],
  )
  const monthlyExportOptions = useMemo(
    () => getMonthlyExportOptions(reconciliation.rows),
    [reconciliation.rows],
  )
  const quarterlyExportOptions = useMemo(
    () => getQuarterlyExportOptions(reconciliation.rows),
    [reconciliation.rows],
  )
  const annualExportOptions = useMemo(
    () => getAnnualExportOptions(reconciliation.rows),
    [reconciliation.rows],
  )
  const exportPeriodOptions =
    exportGranularity === 'monthly'
      ? monthlyExportOptions
      : exportGranularity === 'quarterly'
        ? quarterlyExportOptions
        : annualExportOptions
  const pagination =
    reconciliation.pagination ?? EMPTY_RECONCILIATION_PAGINATION
  const matchRate =
    reconciliation.summary.totalRecords === 0
      ? 0
      : Math.round(
          (reconciliation.summary.matched /
            reconciliation.summary.totalRecords) *
            100,
        )
  const pendingOutreachCount = countPendingReconciliationCustomerEmailGroups(
    reconciliation.rows,
  )

  const openSalesReport = useCallback(
    (reportId: string) => {
      void navigate({
        to: '/reconciliation/reports/$reportId',
        params: { reportId },
        search: {
          ...defaultSalesReportDetailSearch,
          entityId: search.entityId,
        },
      })
    },
    [navigate, search.entityId],
  )

  const updateSearch = useCallback(
    (
      patch: Partial<typeof search>,
      options: { resetPage?: boolean } = { resetPage: true },
    ) => {
      void navigate({
        search: (previous) =>
          parseReconciliationSearch({
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

  const refreshReports = useCallback(async () => {
    setIsLoadingReports(true)
    try {
      const params = new URLSearchParams()
      if (search.entityId) params.set('entityId', search.entityId)
      params.set('page', String(reportPage))
      params.set('pageSize', String(SALES_REPORT_PAGE_SIZE))
      const response = await fetch(`/api/sales-reports?${params.toString()}`, {
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => null)) as
        | (SalesReportListResponse & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load sales reports (${response.status}).`,
        )
      }

      setReports(payload ?? EMPTY_REPORTS)
      setLoadError(null)
    } catch (error) {
      setReports(EMPTY_REPORTS)
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load sales reports.',
      )
    } finally {
      setIsLoadingReports(false)
    }
  }, [reportPage, search.entityId])

  const refreshReconciliation = useCallback(async () => {
    setIsLoadingRows(true)
    try {
      const queryString = buildReconciliationQueryParams(search).toString()
      const response = await fetch(`/api/reconciliation?${queryString}`, {
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => null)) as
        | (ReconciliationListView & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load reconciliation results (${response.status}).`,
        )
      }

      setReconciliation(payload ?? EMPTY_RECONCILIATION)
      setSelectedId((current) =>
        current && payload?.rows.some((row) => row.id === current)
          ? current
          : (payload?.rows.at(0)?.id ?? null),
      )
      setLoadError(null)
    } catch (error) {
      setReconciliation(EMPTY_RECONCILIATION)
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load reconciliation results.',
      )
    } finally {
      setIsLoadingRows(false)
    }
  }, [search])

  useEffect(() => {
    if (isChildRoute) {
      return
    }

    ensureEntitiesLoaded()
    void refreshReports()
    void refreshReconciliation()
  }, [
    ensureEntitiesLoaded,
    isChildRoute,
    refreshReconciliation,
    refreshReports,
  ])

  useEffect(() => {
    setReportPage(1)
  }, [search.entityId])

  useEffect(() => {
    setSelectedExportPeriod((current) => {
      if (
        current &&
        exportPeriodOptions.some((option) => option.value === current)
      ) {
        return current
      }

      return exportPeriodOptions.at(0)?.value ?? ''
    })
  }, [exportPeriodOptions])

  const handleUploadFile = useCallback(
    async (file: File | null) => {
      if (!file) return
      if (!search.entityId) {
        toast.error('Choose an entity before uploading a sales report.')
        return
      }

      setIsUploading(true)
      setUploadProgress(0)
      try {
        const presignResponse = await fetch('/api/sales-reports/presign', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entityId: Number.parseInt(search.entityId, 10),
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
              `Failed to prepare sales report upload (${presignResponse.status}).`,
          )
        }

        await xhrPut(
          presignPayload.upload.url,
          file,
          presignPayload.upload.headers,
          setUploadProgress,
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
          .catch(() => null)) as {
          id?: string
          status?: string
          error?: string
        } | null

        if (!completeResponse.ok) {
          throw new Error(
            completePayload?.error ||
              `Failed to process sales report (${completeResponse.status}).`,
          )
        }

        await refreshReports()
        await refreshReconciliation()
        toast.success('Sales report uploaded.')
        void navigate({
          to: '/reconciliation/reports/$reportId',
          params: { reportId: presignPayload.upload.reportId },
          search: {
            ...defaultSalesReportDetailSearch,
            entityId: search.entityId,
          },
        })
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Unable to upload sales report.',
        )
      } finally {
        setIsUploading(false)
        setUploadProgress(0)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [navigate, refreshReconciliation, refreshReports, search.entityId],
  )

  const handleSendEmail = useCallback(
    async (row: ReconciliationRowView) => {
      setEmailingCustomerGroupKey(getReconciliationCustomerEmailGroupKey(row))
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

        await refreshReconciliation()
        toast.success('Email sent successfully', {
          description:
            payload?.message || `Email sent for ${row.customerName}.`,
        })
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to send reconciliation email.'

        toast.error('Unable to send reconciliation email.', {
          description: message,
        })
      } finally {
        setEmailingCustomerGroupKey(null)
      }
    },
    [refreshReconciliation],
  )

  const handleExport = useCallback(async () => {
    if (!selectedExportPeriod) return
    setIsExporting(true)
    try {
      const params = new URLSearchParams({
        granularity: exportGranularity,
        periodValue: selectedExportPeriod,
      })
      if (search.entityId) params.set('entityId', search.entityId)
      const normalizedCustomerName = exportCustomerName.trim()
      if (normalizedCustomerName) {
        params.set('customerName', normalizedCustomerName)
      }
      const response = await fetch(
        `/api/reconciliation/export?${params.toString()}`,
      )

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(
          payload?.error ||
            `Failed to export reconciliation workbook (${response.status}).`,
        )
      }

      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') ?? ''
      const fileName =
        disposition.match(/filename="([^"]+)"/i)?.[1]?.trim() ??
        'Reconciliation-Report.xlsx'
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = fileName
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
      toast.success('Export ready', {
        description: `${fileName} has been downloaded.`,
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to export reconciliation workbook.',
      )
    } finally {
      setIsExporting(false)
    }
  }, [
    exportCustomerName,
    exportGranularity,
    search.entityId,
    selectedExportPeriod,
  ])

  if (isChildRoute) return <Outlet />

  return (
    <AppShell
      title="Reconciliation"
      subtitle="Upload sales reports, choose batches, and review active reconciliation results"
      pageHelp={{
        label: 'Guide me through this page',
        onStartTour: () => setTourStartSignal((current) => current + 1),
      }}
      tourTargets={{
        title: RECONCILIATION_TOUR_TARGETS.title,
      }}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 overflow-hidden">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            void handleUploadFile(event.target.files?.item(0) ?? null)
          }}
        />

        {loadError ? (
          <StatusBanner tone="danger">{loadError}</StatusBanner>
        ) : null}

        <div
          className="grid shrink-0 gap-2 sm:grid-cols-2 xl:grid-cols-4"
          {...getProductTourTargetProps(RECONCILIATION_TOUR_TARGETS.summary)}
        >
          <SummaryMetricCard
            icon={IconReceipt2}
            label="Active records"
            value={reconciliation.summary.totalRecords}
            description="Rows in current view"
          />
          <SummaryMetricCard
            icon={IconCheck}
            label="Matched"
            value={reconciliation.summary.matched}
            description={`${matchRate}% match rate`}
          />
          <SummaryMetricCard
            icon={IconAlertCircle}
            label="Unmatched"
            value={reconciliation.summary.unmatched}
            description="Needs review"
          />
          <SummaryMetricCard
            icon={IconScale}
            label="Variance total"
            value={formatAmount(reconciliation.summary.varianceTotal)}
            description="Combined variance"
          />
        </div>

        <Card
          size="sm"
          className="shrink-0 rounded-lg border border-border/70 shadow-none ring-0"
          {...getProductTourTargetProps(
            RECONCILIATION_TOUR_TARGETS.salesReports,
          )}
        >
          <CardHeader className="gap-3 border-b border-border/60">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <CardTitle className="text-sm">Sales reports</CardTitle>
                <CardDescription className="text-xs">
                  {selectedEntity
                    ? `Reports for ${selectedEntity.label}`
                    : 'Select an entity in the header to upload and scope reports.'}
                </CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!search.entityId || isUploading}
                onClick={() => inputRef.current?.click()}
              >
                {isUploading ? (
                  <IconLoader2
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : (
                  <IconPlus data-icon="inline-start" />
                )}
                {isUploading ? `Uploading ${uploadProgress}%` : 'Upload report'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={statusToneStyles.neutral}>
                {reports.summary.total} reports
              </Badge>
              <Badge variant="outline" className={statusToneStyles.success}>
                {reports.summary.ready} ready
              </Badge>
              <Badge variant="outline" className={statusToneStyles.danger}>
                {reports.summary.error} errors
              </Badge>
              <Badge variant="outline" className={statusToneStyles.info}>
                {reports.summary.uploading} uploading
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div
              {...getProductTourTargetProps(
                RECONCILIATION_TOUR_TARGETS.salesReportsTable,
              )}
            >
              <SalesReportTable
                reports={reports.reports}
                isLoading={isLoadingReports}
                onOpenReport={openSalesReport}
              />
            </div>
            <PaginationBar
              pagination={reports.pagination}
              itemLabel="reports"
              onPrevious={() =>
                setReportPage((current) => Math.max(1, current - 1))
              }
              onNext={() => setReportPage((current) => current + 1)}
            />
          </CardContent>
        </Card>

        <Card
          size="sm"
          className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/70 shadow-none ring-0"
        >
          <CardHeader className="shrink-0 gap-4 border-b border-border/60">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <CardTitle className="text-sm">
                  Active reconciliation results
                </CardTitle>
                <CardDescription className="max-w-2xl text-xs">
                  Server-filtered active rows from the latest non-archived sales
                  report runs.
                </CardDescription>
              </div>
              <FieldGroup
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,170px)_minmax(0,220px)_minmax(0,220px)_auto]"
                {...getProductTourTargetProps(
                  RECONCILIATION_TOUR_TARGETS.resultsExport,
                )}
              >
                <Field>
                  <FieldLabel htmlFor="reconciliation-export-granularity">
                    Export type
                  </FieldLabel>
                  <Select
                    value={exportGranularity}
                    onValueChange={(value: string | null) => {
                      if (
                        value === 'monthly' ||
                        value === 'quarterly' ||
                        value === 'annual'
                      ) {
                        setExportGranularity(value)
                      }
                    }}
                  >
                    <SelectTrigger id="reconciliation-export-granularity">
                      <SelectValue placeholder="Export type" />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectGroup>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="quarterly">Quarterly</SelectItem>
                        <SelectItem value="annual">Annual</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="reconciliation-export-period">
                    Period
                  </FieldLabel>
                  <Select
                    value={selectedExportPeriod}
                    onValueChange={(value: string | null) => {
                      if (value) setSelectedExportPeriod(value)
                    }}
                  >
                    <SelectTrigger id="reconciliation-export-period">
                      <SelectValue placeholder="Select period" />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectGroup>
                        {exportPeriodOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="reconciliation-export-customer-name">
                    Customer name
                  </FieldLabel>
                  <Input
                    id="reconciliation-export-customer-name"
                    value={exportCustomerName}
                    onChange={(event) =>
                      setExportCustomerName(event.target.value)
                    }
                    placeholder="Optional customer name"
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !canExportSheet || !selectedExportPeriod || isExporting
                    }
                    onClick={() => void handleExport()}
                  >
                    <IconDownload data-icon="inline-start" />
                    {isExporting ? 'Exporting...' : 'Export'}
                  </Button>
                </div>
              </FieldGroup>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={statusToneStyles.success}>
                {matchRate}% matched
              </Badge>
              <Badge
                variant="outline"
                className={
                  pendingOutreachCount > 0
                    ? statusToneStyles.warning
                    : statusToneStyles.neutral
                }
              >
                {pendingOutreachCount} pending outreach
              </Badge>
            </div>
          </CardHeader>
          <CardContent
            className="flex min-h-0 flex-1 flex-col gap-3"
            {...getProductTourTargetProps(
              RECONCILIATION_TOUR_TARGETS.resultsPagination,
            )}
          >
            <div
              className="rounded-lg border border-border/70 bg-muted/20 p-3"
              {...getProductTourTargetProps(
                RECONCILIATION_TOUR_TARGETS.resultsFilters,
              )}
            >
              <FieldGroup className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,240px)_minmax(0,180px)_auto] xl:items-end">
                <Field>
                  <FieldLabel htmlFor="reconciliation-search">
                    Search
                  </FieldLabel>
                  <div className="relative">
                    <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="reconciliation-search"
                      className="pl-9"
                      value={search.q}
                      onChange={(event) =>
                        updateSearch({ q: event.target.value })
                      }
                      placeholder="Search customer, TIN, invoice, or transaction line"
                    />
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="reconciliation-filter">
                    Filter
                  </FieldLabel>
                  <Select
                    value={search.filter}
                    onValueChange={(value: string | null) => {
                      if (value) {
                        updateSearch({
                          filter: value as ReconciliationTableFilterValue,
                        })
                      }
                    }}
                  >
                    <SelectTrigger id="reconciliation-filter">
                      <SelectValue placeholder="Filter rows" />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        {reconciliationTableFilterOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="reconciliation-page-size">
                    Rows per page
                  </FieldLabel>
                  <Select
                    value={String(search.pageSize)}
                    onValueChange={(value: string | null) => {
                      if (value) updateSearch({ pageSize: Number(value) })
                    }}
                  >
                    <SelectTrigger id="reconciliation-page-size">
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
                {search.q || search.filter !== 'all' ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => updateSearch({ q: '', filter: 'all' })}
                  >
                    Clear
                  </Button>
                ) : null}
              </FieldGroup>
            </div>

            <div
              className="min-h-0 flex-1 overflow-hidden"
              {...getProductTourTargetProps(
                RECONCILIATION_TOUR_TARGETS.resultsTable,
              )}
            >
              {isLoadingRows ? (
                <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed bg-muted/10 text-sm text-muted-foreground">
                  Loading reconciliation results...
                </div>
              ) : (
                <ReconciliationResultsTable
                  rows={reconciliation.rows}
                  density="compact"
                  selectedRowId={selectedId}
                  emailingCustomerGroupKey={emailingCustomerGroupKey}
                  emptyMessage="No reconciliation rows match the current filters."
                  emptyDescription="Open a sales report, select closed batches, and run reconciliation to populate active results."
                  onEmailRow={
                    canSendReconciliationEmail
                      ? (row) => void handleSendEmail(row)
                      : undefined
                  }
                  onRowSelect={(row) => {
                    setSelectedId(row.id)
                    setDrawerOpen(true)
                  }}
                />
              )}
            </div>

            <div>
              {pagination.totalItems > 0 ? (
                <PaginationBar
                  pagination={pagination}
                  itemLabel="rows"
                  onPrevious={() =>
                    updateSearch(
                      { page: Math.max(pagination.page - 1, 1) },
                      { resetPage: false },
                    )
                  }
                  onNext={() =>
                    updateSearch(
                      {
                        page: Math.min(
                          pagination.page + 1,
                          pagination.totalPages,
                        ),
                      },
                      { resetPage: false },
                    )
                  }
                />
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedRow ? (
        <ReconciliationDetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          row={selectedRow}
          onEmailRow={
            canSendReconciliationEmail
              ? (row) => void handleSendEmail(row)
              : undefined
          }
          emailingCustomerGroupKey={emailingCustomerGroupKey}
        />
      ) : null}
      <ReconciliationTour startSignal={tourStartSignal} />
    </AppShell>
  )
}
