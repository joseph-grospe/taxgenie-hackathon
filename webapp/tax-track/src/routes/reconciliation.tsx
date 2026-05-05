import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import {
  IconAlertCircle,
  IconCheck,
  IconClockHour4,
  IconFileSpreadsheet,
  IconPercentage,
  IconReceipt2,
  IconScale,
  IconUsers,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Icon } from '@tabler/icons-react'

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
  filterReconciliationRows,
  paginateReconciliationRows,
  reconciliationPageSizeOptions,
  reconciliationTableFilterOptions,
} from '@/lib/reconciliation-table-state'
import {
  getMonthlyExportOptions,
  getQuarterlyExportOptions,
} from '@/lib/reconciliation-report'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export const Route = createFileRoute('/reconciliation')({
  component: RouteComponent,
})

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const PANEL_CARD_CLASS = 'border border-border/70 shadow-sm'
const PANEL_BORDER_CLASS = 'border-border/70'

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
    <Alert
      variant={tone === 'danger' ? 'destructive' : 'default'}
      className="rounded-lg"
    >
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
    <Card size="sm" className={PANEL_CARD_CLASS}>
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

function DetailChip({
  icon: IconComponent,
  label,
  value,
}: {
  icon: Icon
  label: string
  value: string
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border bg-muted/20 p-3 ${PANEL_BORDER_CLASS}`}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-primary">
        <IconComponent className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-base font-semibold">{value}</p>
      </div>
    </div>
  )
}

function LoadingTableState() {
  return (
    <div
      className={`flex min-h-[280px] flex-1 items-center justify-center rounded-lg border border-dashed bg-muted/10 p-8 text-center text-sm text-muted-foreground ${PANEL_BORDER_CLASS}`}
    >
      Loading reconciliation results...
    </div>
  )
}

function TableMeta({
  startRow,
  endRow,
  filteredRows,
  page,
  totalPages,
}: {
  startRow: number
  endRow: number
  filteredRows: number
  page: number
  totalPages: number
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <p>
        Showing {startRow}-{endRow} of {filteredRows} rows
      </p>
      <p>
        Page {page} of {totalPages}
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
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 overflow-hidden">
        {loadError ? (
          <StatusBanner tone="danger">{loadError}</StatusBanner>
        ) : null}

        {emailError ? (
          <StatusBanner tone="danger">{emailError}</StatusBanner>
        ) : null}

        <div className="grid shrink-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryMetricCard
            icon={IconReceipt2}
            label="Total records"
            value={summary.totalRecords}
            description="Rows stored"
          />
          <SummaryMetricCard
            icon={IconCheck}
            label="Matched"
            value={summary.matched}
            description="Aligned records"
          />
          <SummaryMetricCard
            icon={IconAlertCircle}
            label="Unmatched"
            value={summary.unmatched}
            description="Needs review"
          />
          <SummaryMetricCard
            icon={IconScale}
            label="Variance total"
            value={formatAmount(summary.varianceTotal)}
            description="Combined variance"
          />
        </div>

        <Card size="sm" className={`shrink-0 ${PANEL_CARD_CLASS}`}>
          <CardContent className="grid gap-3 p-3 sm:grid-cols-3">
            <DetailChip
              icon={IconPercentage}
              label="Match rate"
              value={`${matchRate}%`}
            />
            <DetailChip
              icon={IconUsers}
              label="Pending outreach"
              value={String(pendingOutreachCount)}
            />
            <DetailChip
              icon={IconClockHour4}
              label="Periods ready"
              value={String(currentPeriodCount)}
            />
          </CardContent>
        </Card>

        <Card
          size="sm"
          className={`flex min-h-0 flex-1 flex-col ${PANEL_CARD_CLASS}`}
        >
          <CardHeader
            className={`shrink-0 gap-4 border-b ${PANEL_BORDER_CLASS}`}
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <CardTitle className="text-sm">Reconciliation table</CardTitle>
                <CardDescription className="max-w-2xl text-xs">
                  Compare saved sales report rows against matched 2307 records.
                </CardDescription>
              </div>
              <FieldGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,170px)_minmax(0,220px)_auto]">
                <Field>
                  <FieldLabel htmlFor="reconciliation-export-granularity">
                    Export type
                  </FieldLabel>
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
                      className="w-full"
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
                </Field>

                <Field>
                  <FieldLabel htmlFor="reconciliation-export-period">
                    Period
                  </FieldLabel>
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
                      className="w-full"
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
                </Field>

                <div className="flex items-end">
                  <Button
                    variant="outline"
                    className="w-full xl:w-auto"
                    disabled={
                      !canExportSheet || !selectedExportPeriod || isExporting
                    }
                    onClick={() => void handleExport()}
                  >
                    <IconFileSpreadsheet data-icon="inline-start" />
                    {isExporting ? 'Exporting...' : 'Export sheet'}
                  </Button>
                </div>
              </FieldGroup>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{visibleRowDescription}</Badge>
              <Badge variant="outline">{matchRate}% matched</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            {isLoading ? (
              <LoadingTableState />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div
                  className={`rounded-lg border bg-muted/20 p-3 ${PANEL_BORDER_CLASS}`}
                >
                  <FieldGroup className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,240px)_minmax(0,180px)_auto] xl:items-end">
                    <Field>
                      <FieldLabel htmlFor="reconciliation-search">
                        Search
                      </FieldLabel>
                      <Input
                        id="reconciliation-search"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="Search customer, TIN, invoice, or transaction line"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="reconciliation-filter">
                        Filter
                      </FieldLabel>
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
                          className="w-full"
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
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="reconciliation-page-size">
                        Rows per page
                      </FieldLabel>
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
                          className="w-full"
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
                    </Field>

                    {hasActiveTableControls ? (
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="outline"
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
                  </FieldGroup>
                </div>

                <TableMeta
                  startRow={startRow}
                  endRow={endRow}
                  filteredRows={filteredRows.length}
                  page={page}
                  totalPages={totalPages}
                />

                <div className="min-h-0 flex-1 overflow-hidden">
                  <ReconciliationResultsTable
                    rows={paginatedRows}
                    density="compact"
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
                        variant="outline"
                        onClick={() =>
                          setPage((currentPage) => Math.max(currentPage - 1, 1))
                        }
                        disabled={page === 1}
                      >
                        Previous
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
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
