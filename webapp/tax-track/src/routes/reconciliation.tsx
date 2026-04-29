import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import {
  IconAlertCircle,
  IconCheck,
  IconFileSpreadsheet,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import type {
  ReconciliationListView,
  ReconciliationRowView,
} from '@/lib/reconciliation-types'
import type { ReconciliationTableFilterValue } from '@/lib/reconciliation-table-state'
import type { ReconciliationExportGranularity } from '@/lib/reconciliation-report'
import { AppShell } from '@/components/app-shell'
import { authClient } from '@/lib/auth-client'
import { canExport, parseSessionContext } from '@/lib/access-control'
import {
  countPendingReconciliationCustomerEmailGroups,
  getReconciliationCustomerEmailGroupKey,
} from '@/lib/reconciliation-customer-groups'
import { ReconciliationResultsTable } from '@/components/reconciliation-results-table'
import { ReconciliationDetailDrawer } from '@/components/reconciliation-detail-drawer'
import { formatStatusLabel } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  filterReconciliationRows,
  paginateReconciliationRows,
  reconciliationPageSizeOptions,
  reconciliationTableFilterOptions,
} from '@/lib/reconciliation-table-state'
import {
  getMonthlyExportOptions,
  getQuarterlyExportOptions,
} from '@/lib/reconciliation-report'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/reconciliation')({
  component: RouteComponent,
})

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatAmount = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : NUMBER_FORMATTER.format(value)

function StatusBanner({
  tone,
  children,
}: {
  tone: 'danger' | 'success'
  children: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-[26px] border px-4 py-3 text-sm shadow-sm',
        tone === 'danger'
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700',
      )}
    >
      {tone === 'danger' ? (
        <IconAlertCircle className="mt-0.5 shrink-0" />
      ) : (
        <IconCheck className="mt-0.5 shrink-0" />
      )}
      <span>{children}</span>
    </div>
  )
}

function SummaryMetricCard({
  label,
  value,
  description,
}: {
  label: string
  value: string | number
  description: string
}) {
  return (
    <div className="rounded-[28px] border border-border/70 bg-background p-5 shadow-sm">
      <p className="text-[0.68rem] uppercase tracking-[0.34em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function DetailChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-border/70 bg-background px-4 py-3 shadow-sm">
      <p className="text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 truncate text-sm font-medium text-foreground">
        {value}
      </p>
    </div>
  )
}

function RouteComponent() {
  const { data: session } = authClient.useSession()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isDetailRoute =
    pathname !== '/reconciliation' && pathname.startsWith('/reconciliation/')
  const context = session?.user ? parseSessionContext(session.user) : null
  const canExportSheet = context
    ? canExport.excel(context.role, context.canExportExcel)
    : false

  const [rows, setRows] = useState<Array<ReconciliationRowView>>([])
  const [summary, setSummary] = useState<ReconciliationListView['summary']>({
    totalRecords: 0,
    matched: 0,
    unmatched: 0,
    varianceTotal: 0,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailingCustomerGroupKey, setEmailingCustomerGroupKey] = useState<
    string | null
  >(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterValue, setFilterValue] =
    useState<ReconciliationTableFilterValue>('all')
  const [exportGranularity, setExportGranularity] =
    useState<ReconciliationExportGranularity>('monthly')
  const [selectedExportPeriod, setSelectedExportPeriod] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [pageSize, setPageSize] = useState<number>(10)
  const [page, setPage] = useState(1)

  const refreshReconciliation = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/reconciliation', {
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

      const nextRows = Array.isArray(payload?.rows) ? payload.rows : []
      const nextSummary = payload?.summary ?? {
        totalRecords: 0,
        matched: 0,
        unmatched: 0,
        varianceTotal: 0,
      }

      setRows(nextRows)
      setSummary(nextSummary)
      setSelectedId((current) => {
        if (current && nextRows.some((row) => row.id === current)) {
          return current
        }

        return nextRows.at(0)?.id ?? null
      })
      setLoadError(null)
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load reconciliation results.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isDetailRoute) {
      return
    }

    void refreshReconciliation()
  }, [isDetailRoute, refreshReconciliation])

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? rows.at(0) ?? null,
    [rows, selectedId],
  )

  const selectedRowStatus = formatStatusLabel(selectedRow?.matchStatus ?? '')

  const monthlyExportOptions = useMemo(
    () => getMonthlyExportOptions(rows),
    [rows],
  )

  const quarterlyExportOptions = useMemo(
    () => getQuarterlyExportOptions(rows),
    [rows],
  )

  const exportPeriodOptions =
    exportGranularity === 'monthly'
      ? monthlyExportOptions
      : quarterlyExportOptions

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
  }, [exportGranularity, exportPeriodOptions])

  const filteredRows = useMemo(
    () => filterReconciliationRows(rows, searchTerm, filterValue),
    [filterValue, rows, searchTerm],
  )

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))

  useEffect(() => {
    setPage(1)
  }, [filterValue, pageSize, searchTerm])

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages))
  }, [totalPages])

  const paginatedRows = useMemo(
    () => paginateReconciliationRows(filteredRows, page, pageSize),
    [filteredRows, page, pageSize],
  )

  const startRow = filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1
  const endRow =
    filteredRows.length === 0
      ? 0
      : Math.min(page * pageSize, filteredRows.length)
  const hasActiveTableControls =
    searchTerm.trim().length > 0 || filterValue !== 'all'
  const matchRate =
    summary.totalRecords === 0
      ? 0
      : Math.round((summary.matched / summary.totalRecords) * 100)
  const pendingOutreachCount =
    countPendingReconciliationCustomerEmailGroups(rows)
  const currentPeriodCount = exportPeriodOptions.length
  const visibleRowDescription =
    filteredRows.length === rows.length
      ? `${rows.length} total rows loaded`
      : `${filteredRows.length} of ${rows.length} rows in view`

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
          to?: Array<string>
          cc?: Array<string>
          customerName?: string
          sentRowCount?: number
          sentRowIds?: Array<number>
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
            payload?.message || `Email sent for customer ${row.customerName}.`,
        })
      } catch (error) {
        setEmailError(
          error instanceof Error
            ? error.message
            : 'Unable to send reconciliation email.',
        )
      } finally {
        setEmailingCustomerGroupKey(null)
      }
    },
    [refreshReconciliation],
  )

  const handleExport = useCallback(async () => {
    if (!selectedExportPeriod) {
      return
    }

    setIsExporting(true)

    try {
      const searchParams = new URLSearchParams({
        granularity: exportGranularity,
        periodValue: selectedExportPeriod,
      })
      const response = await fetch(
        `/api/reconciliation/export?${searchParams.toString()}`,
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
      const fileNameMatch =
        disposition.match(/filename="([^"]+)"/i) ??
        disposition.match(/filename=([^;]+)/i)
      const fileName =
        fileNameMatch?.[1]?.trim() ?? 'Reconciliation-Report.xlsx'

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
  }, [exportGranularity, selectedExportPeriod])

  // This route is the parent of `/reconciliation/$rowId`; render the child page
  // via <Outlet /> when we're on a detail URL.
  if (isDetailRoute) return <Outlet />

  return (
    <AppShell
      title="Reconciliation"
      subtitle="Review historical batch reconciliation results across all upload batches"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-6 overflow-hidden">
        {loadError ? (
          <StatusBanner tone="danger">{loadError}</StatusBanner>
        ) : null}

        {emailError ? (
          <StatusBanner tone="danger">{emailError}</StatusBanner>
        ) : null}

        <div className="shrink-0">
          <Card className="border border-border/70 bg-muted/20 shadow-sm">
            <CardHeader className="gap-3">
              <CardTitle className="text-2xl font-semibold tracking-tight">
                Reconciliation summary
              </CardTitle>
              <CardDescription>
                Latest persisted reconciliation results with current
                reconciliation health at a glance.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <SummaryMetricCard
                label="Total records"
                value={summary.totalRecords}
                description="Rows currently stored for reconciliation."
              />
              <SummaryMetricCard
                label="Matched"
                value={summary.matched}
                description="Rows aligned with 2307 certificate records."
              />
              <SummaryMetricCard
                label="Unmatched"
                value={summary.unmatched}
                description="Rows still requiring review or follow-up."
              />
              <SummaryMetricCard
                label="Variance total"
                value={formatAmount(summary.varianceTotal)}
                description="Combined variance across saved reconciliation rows."
              />
            </CardContent>
            <CardFooter className="border-t border-border/60 pt-6">
              <div className="grid w-full gap-3 sm:grid-cols-3">
                <DetailChip label="Match rate" value={`${matchRate}%`} />
                <DetailChip
                  label="Pending outreach"
                  value={String(pendingOutreachCount)}
                />
                <DetailChip
                  label="Periods ready"
                  value={String(currentPeriodCount)}
                />
              </div>
            </CardFooter>
          </Card>
        </div>

        <Card className="flex min-h-0 flex-1 flex-col border border-border/70 shadow-sm">
          <CardHeader className="shrink-0 gap-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <CardTitle className="text-2xl font-semibold tracking-tight">
                  Reconciliation table
                </CardTitle>
                <CardDescription className="max-w-2xl leading-6">
                  Compare saved sales report rows against matched 2307 records.
                </CardDescription>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,180px)_minmax(0,220px)_auto]">
                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor="reconciliation-export-granularity">
                    Export type
                  </Label>
                  <Select
                    value={exportGranularity}
                    onValueChange={(value: string | null) => {
                      if (value === 'monthly' || value === 'quarterly') {
                        setExportGranularity(value)
                      }
                    }}
                  >
                    <SelectTrigger
                      id="reconciliation-export-granularity"
                      className="h-12 w-full rounded-full bg-background"
                    >
                      <SelectValue placeholder="Export type" />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectGroup>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="quarterly">Quarterly</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor="reconciliation-export-period">Period</Label>
                  <Select
                    value={selectedExportPeriod}
                    onValueChange={(value: string | null) => {
                      if (value) {
                        setSelectedExportPeriod(value)
                      }
                    }}
                  >
                    <SelectTrigger
                      id="reconciliation-export-period"
                      className="h-12 w-full rounded-full bg-background"
                    >
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
                </div>

                <div className="flex items-end">
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 w-full px-5 shadow-sm xl:w-auto"
                    disabled={
                      !canExportSheet || !selectedExportPeriod || isExporting
                    }
                    onClick={() => void handleExport()}
                  >
                    <IconFileSpreadsheet data-icon="inline-start" />
                    {isExporting ? 'Exporting...' : 'Export sheet'}
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="rounded-full px-3 py-1">
                {visibleRowDescription}
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                {matchRate}% matched
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col">
            {isLoading ? (
              <div className="flex min-h-[280px] flex-1 items-center justify-center rounded-[28px] border border-dashed border-border/60 bg-muted/10 p-8 text-center text-sm text-muted-foreground">
                Loading reconciliation results...
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                <div className="rounded-[28px] border border-border/60 bg-muted/15 p-4">
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,260px)_minmax(0,220px)_auto] xl:items-end">
                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor="reconciliation-search">Search</Label>
                      <Input
                        id="reconciliation-search"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="Search customer, TIN, invoice, or transaction line"
                        className="h-12 rounded-full bg-background px-5"
                      />
                    </div>

                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor="reconciliation-filter">Filter</Label>
                      <Select
                        value={filterValue}
                        onValueChange={(value: string | null) => {
                          if (value) {
                            setFilterValue(
                              value as ReconciliationTableFilterValue,
                            )
                          }
                        }}
                      >
                        <SelectTrigger
                          id="reconciliation-filter"
                          className="h-12 w-full rounded-full bg-background"
                        >
                          <SelectValue placeholder="Filter rows" />
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
                    </div>

                    <div className="flex min-w-0 flex-col gap-2">
                      <Label htmlFor="reconciliation-page-size">
                        Rows per page
                      </Label>
                      <Select
                        value={String(pageSize)}
                        onValueChange={(value: string | null) => {
                          if (value) {
                            setPageSize(Number.parseInt(value, 10))
                          }
                        }}
                      >
                        <SelectTrigger
                          id="reconciliation-page-size"
                          className="h-12 w-full rounded-full bg-background"
                        >
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
                    </div>

                    {hasActiveTableControls ? (
                      <div className="flex items-end">
                        <Button
                          type="button"
                          size="lg"
                          variant="outline"
                          className="h-12 px-5"
                          onClick={() => {
                            setSearchTerm('')
                            setFilterValue('all')
                            setPage(1)
                          }}
                        >
                          Clear
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <p>
                    Showing {startRow}-{endRow} of {filteredRows.length} rows
                  </p>
                  <p>
                    Page {page} of {totalPages}
                  </p>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden">
                  <ReconciliationResultsTable
                    rows={paginatedRows}
                    selectedRowId={selectedId}
                    emailingCustomerGroupKey={emailingCustomerGroupKey}
                    emptyMessage="No reconciliation rows match the current search or filter."
                    onEmailRow={(row) => void handleSendEmail(row)}
                    onRowSelect={(row) => {
                      setSelectedId(row.id)
                      setDrawerOpen(true)
                    }}
                  />
                </div>

                {filteredRows.length > 0 ? (
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      Showing {startRow}-{endRow} of {filteredRows.length}{' '}
                      filtered rows
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        className="px-5"
                        onClick={() =>
                          setPage((currentPage) => Math.max(currentPage - 1, 1))
                        }
                        disabled={page === 1}
                      >
                        Previous
                      </Button>
                      <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        className="px-5"
                        onClick={() =>
                          setPage((currentPage) =>
                            Math.min(currentPage + 1, totalPages),
                          )
                        }
                        disabled={page === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedRow ? (
        <ReconciliationDetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={selectedRow.customerName}
          subtitle={selectedRow.invoiceNumber}
          status={selectedRowStatus}
          meta={[
            { label: 'TIN', value: selectedRow.tin },
            {
              label: 'Derived billing month',
              value: selectedRow.derivedBillingMonthMMYY,
            },
            {
              label: 'Accounting date',
              value: selectedRow.accountingDate ?? '—',
            },
          ]}
          amounts={[
            {
              label: 'Taxable Sales',
              value: formatAmount(selectedRow.taxableSales),
            },
            {
              label: 'Prepaid CWT',
              value: formatAmount(selectedRow.prepaidCWT),
            },
            { label: 'Tax Base', value: formatAmount(selectedRow.taxBase) },
            {
              label: 'Tax Withheld',
              value: formatAmount(selectedRow.taxWithheld),
            },
            {
              label: 'Tax Base Difference',
              value: formatAmount(selectedRow.taxBaseDifference),
            },
            {
              label: 'Tax Withheld Difference',
              value: formatAmount(selectedRow.taxWithheldDifference),
            },
          ]}
          openTo={`/reconciliation/${selectedRow.id}`}
        />
      ) : null}
    </AppShell>
  )
}
