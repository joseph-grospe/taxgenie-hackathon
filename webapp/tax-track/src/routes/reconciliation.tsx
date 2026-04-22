import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import {
  IconCloudUpload,
  IconFileSpreadsheet,
  IconUpload,
} from '@tabler/icons-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { toast } from 'sonner'

import { AppShell } from '@/components/app-shell'
import { authClient } from '@/lib/auth-client'
import { canExport, parseSessionContext } from '@/lib/access-control'
import { ReconciliationResultsTable } from '@/components/reconciliation-results-table'
import { ReconciliationDetailDrawer } from '@/components/reconciliation-detail-drawer'
import { formatStatusLabel } from '@/components/status-pill'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
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
  type ReconciliationTableFilterValue,
} from '@/lib/reconciliation-table-state'
import {
  getMonthlyExportOptions,
  getQuarterlyExportOptions,
  type ReconciliationExportGranularity,
} from '@/lib/reconciliation-report'
import type {
  ReconciliationListView,
  ReconciliationRowView,
} from '@/lib/reconciliation-types'
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

const ACCEPTED_EXCEL_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
])

const isExcelFile = (file: File) =>
  /\.(xlsx|xls)$/i.test(file.name) || ACCEPTED_EXCEL_MIME_TYPES.has(file.type)

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

  const inputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Array<ReconciliationRowView>>([])
  const [summary, setSummary] = useState<ReconciliationListView['summary']>({
    totalRecords: 0,
    matched: 0,
    unmatched: 0,
    varianceTotal: 0,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailingRowId, setEmailingRowId] = useState<number | null>(null)
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

      setRows(Array.isArray(payload?.rows) ? payload.rows : [])
      setSummary(
        payload?.summary ?? {
          totalRecords: 0,
          matched: 0,
          unmatched: 0,
          varianceTotal: 0,
        },
      )
      setSelectedId((current) => {
        if (current && payload?.rows?.some((row) => row.id === current)) {
          return current
        }

        return payload?.rows?.[0]?.id ?? null
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
    () => rows.find((row) => row.id === selectedId) ?? rows[0] ?? null,
    [rows, selectedId],
  )

  const selectedRowStatus = selectedRow
    ? formatStatusLabel(selectedRow.matchStatus)
    : 'Unmatched'

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

      return exportPeriodOptions[0]?.value ?? ''
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

  const handleSelectedFile = useCallback((file: File | null) => {
    if (!file) {
      return
    }

    if (!isExcelFile(file)) {
      const message =
        'Invalid file type. Please select an Excel file (.xlsx or .xls).'
      setSelectedFile(null)
      setUploadSuccess(null)
      setUploadError(message)
      toast.error('Invalid file type', {
        description: message,
      })
      return
    }

    setSelectedFile(file)
    setUploadError(null)
    setUploadSuccess(null)
  }, [])

  const handleDropZoneDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setIsDragActive(true)
    },
    [],
  )

  const handleDropZoneDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return
      }

      setIsDragActive(false)
    },
    [],
  )

  const handleDropZoneDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragActive(false)
      handleSelectedFile(event.dataTransfer.files?.[0] ?? null)
    },
    [handleSelectedFile],
  )

  const handleUpload = useCallback(async () => {
    if (!selectedFile) {
      return
    }

    setIsUploading(true)
    setUploadError(null)
    setUploadSuccess(null)
    const uploadToastId = toast.loading('Uploading workbook...', {
      description: 'Validating and processing reconciliation rows.',
    })

    try {
      const formData = new FormData()
      formData.set('file', selectedFile)

      const response = await fetch('/api/reconciliation/import', {
        method: 'POST',
        body: formData,
      })

      const payload = (await response.json().catch(() => null)) as
        | (ReconciliationListView & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to upload reconciliation workbook (${response.status}).`,
        )
      }

      await refreshReconciliation()
      setSelectedFile(null)
      if (inputRef.current) {
        inputRef.current.value = ''
      }
      toast.success('Upload completed', {
        id: uploadToastId,
        description: `Imported ${payload?.rows?.length ?? 0} reconciliation rows successfully.`,
      })
      setLoadError(null)
    } catch (error) {
      toast.error('Upload failed', {
        id: uploadToastId,
        description:
          error instanceof Error ? error.message : 'Upload processing failure.',
      })
      setUploadError(
        error instanceof Error ? error.message : 'Upload processing failure.',
      )
    } finally {
      setIsUploading(false)
    }
  }, [refreshReconciliation, selectedFile])

  const handleSendEmail = useCallback(
    async (row: ReconciliationRowView) => {
      setEmailingRowId(row.id)
      setEmailError(null)

      try {
        const response = await fetch(`/api/reconciliation/${row.id}`, {
          method: 'POST',
        })

        const payload = (await response.json().catch(() => null)) as {
          message?: string
          error?: string
          to?: string
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
            payload?.message || `Email sent for invoice ${row.invoiceNumber}.`,
        })
      } catch (error) {
        setEmailError(
          error instanceof Error
            ? error.message
            : 'Unable to send reconciliation email.',
        )
      } finally {
        setEmailingRowId(null)
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
      subtitle="Match extracted 2307 data with prepaid CWT records"
      actions={
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => {
              handleSelectedFile(event.target.files?.[0] ?? null)
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
          >
            <IconUpload className="size-4" />
            Select file
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleUpload()}
            disabled={!selectedFile || isUploading}
          >
            <IconCloudUpload className="size-4" />
            {isUploading ? 'Uploading...' : 'Upload workbook'}
          </Button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden">
        {loadError ? (
          <div className="shrink-0 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {loadError}
          </div>
        ) : null}

        {uploadError ? (
          <div className="shrink-0 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {uploadError}
          </div>
        ) : null}

        {uploadSuccess ? (
          <div className="shrink-0 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            {uploadSuccess}
          </div>
        ) : null}

        {emailError ? (
          <div className="shrink-0 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {emailError}
          </div>
        ) : null}

        <div className="shrink-0 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="border border-dashed">
            <CardHeader>
              <CardTitle>Import revenue data</CardTitle>
              <CardDescription>
                Bring in prepaid CWT records for matching.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  'flex h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed text-center transition-colors',
                  isDragActive
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : 'border-emerald-500/30 bg-emerald-500/5',
                )}
                onClick={() => inputRef.current?.click()}
                onDragOver={handleDropZoneDragOver}
                onDragLeave={handleDropZoneDragLeave}
                onDrop={handleDropZoneDrop}
              >
                <div className="rounded-full border border-emerald-500/30 bg-white p-3 text-emerald-700">
                  <IconCloudUpload className="size-5" />
                </div>
                <div className="text-sm font-medium">
                  {selectedFile ? selectedFile.name : 'Select sales report'}
                </div>
                <p className="text-xs text-muted-foreground">
                  Drag and drop an Excel file here, or click to browse. Required
                  headers must match the reconciliation template.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reconciliation summary</CardTitle>
              <CardDescription>
                Latest persisted reconciliation results
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  Total records
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {summary.totalRecords}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  Matched
                </p>
                <p className="mt-2 text-2xl font-semibold">{summary.matched}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  Unmatched
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {summary.unmatched}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  Variance total
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {formatAmount(summary.varianceTotal)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="flex min-h-0 flex-1 flex-col">
          <CardHeader className="shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Reconciliation table</CardTitle>
                <CardDescription>
                  Compare saved sales report rows against matched 2307 records.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-32 flex-col gap-2">
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
                </div>

                <div className="flex min-w-40 flex-col gap-2">
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
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !canExportSheet || !selectedExportPeriod || isExporting
                  }
                  onClick={() => void handleExport()}
                >
                  <IconFileSpreadsheet className="size-4" />
                  {isExporting ? 'Exporting...' : 'Export sheet'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col">
            {isLoading ? (
              <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                Loading reconciliation results...
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex min-w-64 flex-1 flex-col gap-2">
                    <Label htmlFor="reconciliation-search">Search</Label>
                    <Input
                      id="reconciliation-search"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search customer, TIN, invoice, or transaction line"
                    />
                  </div>

                  <div className="flex min-w-48 flex-col gap-2">
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
                        className="w-full"
                      >
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
                  </div>

                  <div className="flex min-w-32 flex-col gap-2">
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
                  </div>

                  {hasActiveTableControls ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSearchTerm('')
                        setFilterValue('all')
                        setPage(1)
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
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
                    emailingRowId={emailingRowId}
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
                        size="sm"
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
                        size="sm"
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
