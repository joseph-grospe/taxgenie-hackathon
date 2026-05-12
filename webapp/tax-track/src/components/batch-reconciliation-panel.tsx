import {
  IconAlertCircle,
  IconCheck,
  IconClockHour4,
  IconCloudUpload,
  IconDownload,
  IconFileSpreadsheet,
  IconLoader2,
  IconPercentage,
  IconReceipt2,
  IconScale,
  IconUsers,
} from '@tabler/icons-react'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Icon } from '@tabler/icons-react'
import type { DragEvent } from 'react'

import type {
  ReconciliationListView,
  ReconciliationRowView,
} from '@/lib/reconciliation-types'
import type { ReconciliationTableFilterValue } from '@/lib/reconciliation-table-state'
import type { IntakeBatchView } from '@/lib/upload-intake-types'
import { ReconciliationDetailDrawer } from '@/components/reconciliation-detail-drawer'
import { ReconciliationResultsTable } from '@/components/reconciliation-results-table'
import { formatStatusLabel } from '@/components/status-pill'
import {
  countPendingReconciliationCustomerEmailGroups,
  getReconciliationCustomerEmailGroupKey,
} from '@/lib/reconciliation-customer-groups'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  sortReconciliationRowsByCustomerName,
} from '@/lib/reconciliation-table-state'
import {
  formatDaysUncollected,
  formatReconciliationTimestamp,
} from '@/lib/reconciliation-display'
import { cn } from '@/lib/utils'

type BatchReconciliationPanelProps = {
  batch: IntakeBatchView | null
  canManageBatchActions: boolean
  canExportSheet: boolean
}

const EMPTY_SUMMARY: ReconciliationListView['summary'] = {
  totalRecords: 0,
  matched: 0,
  unmatched: 0,
  varianceTotal: 0,
}
const PANEL_CARD_CLASS = 'border border-border/70 shadow-sm'
const PANEL_BORDER_CLASS = 'border-border/70'

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const ACCEPTED_EXCEL_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
])

const formatAmount = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : NUMBER_FORMATTER.format(value)

const isExcelFile = (file: File) =>
  /\.(xlsx|xls)$/i.test(file.name) || ACCEPTED_EXCEL_MIME_TYPES.has(file.type)

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
      className={cn(
        'rounded-lg',
        PANEL_BORDER_CLASS,
        tone === 'success' ? 'border-primary/20 bg-primary/5' : undefined,
      )}
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
      className={cn(
        'flex items-center gap-2 rounded-lg border bg-muted/20 p-3',
        PANEL_BORDER_CLASS,
      )}
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

export function BatchReconciliationPanel({
  batch,
  canManageBatchActions,
  canExportSheet,
}: BatchReconciliationPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const batchId = batch?.id ?? null
  const isClosedBatch = batch?.status === 'closed'
  const canImportReconciliation = canManageBatchActions && isClosedBatch
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Array<ReconciliationRowView>>([])
  const [summary, setSummary] =
    useState<ReconciliationListView['summary']>(EMPTY_SUMMARY)
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailingCustomerGroupKey, setEmailingCustomerGroupKey] = useState<
    string | null
  >(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterValue, setFilterValue] =
    useState<ReconciliationTableFilterValue>('all')
  const [pageSize, setPageSize] = useState<number>(10)
  const [page, setPage] = useState(1)
  const [isExporting, setIsExporting] = useState(false)

  const refreshReconciliation = useCallback(async () => {
    if (!batchId) {
      setRows([])
      setSummary(EMPTY_SUMMARY)
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(
        `/api/uploads/batches/${encodeURIComponent(batchId)}/reconciliation`,
        { cache: 'no-store' },
      )
      const payload = (await response.json().catch(() => null)) as
        | (ReconciliationListView & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load batch reconciliation results (${response.status}).`,
        )
      }

      const nextRows = Array.isArray(payload?.rows) ? payload.rows : []
      const sortedNextRows = sortReconciliationRowsByCustomerName(nextRows)
      setRows(nextRows)
      setSummary(payload?.summary ?? EMPTY_SUMMARY)
      setSelectedId((current) =>
        current && nextRows.some((row) => row.id === current)
          ? current
          : (sortedNextRows.at(0)?.id ?? null),
      )
      setLoadError(null)
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load batch reconciliation results.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [batchId])

  useEffect(() => {
    void refreshReconciliation()
  }, [refreshReconciliation])

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? rows.at(0) ?? null,
    [rows, selectedId],
  )

  const selectedRowStatus = formatStatusLabel(selectedRow?.matchStatus ?? '')

  const filteredRows = useMemo(
    () => filterReconciliationRows(rows, searchTerm, filterValue),
    [filterValue, rows, searchTerm],
  )

  const sortedRows = useMemo(
    () => sortReconciliationRowsByCustomerName(filteredRows),
    [filteredRows],
  )

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))

  useEffect(() => {
    setPage(1)
  }, [filterValue, pageSize, searchTerm])

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages))
  }, [totalPages])

  const paginatedRows = useMemo(
    () => paginateReconciliationRows(sortedRows, page, pageSize),
    [page, pageSize, sortedRows],
  )

  const matchRate =
    summary.totalRecords === 0
      ? 0
      : Math.round((summary.matched / summary.totalRecords) * 100)
  const pendingOutreachCount =
    countPendingReconciliationCustomerEmailGroups(rows)
  const selectedFileName = selectedFile?.name ?? 'No workbook selected'
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
      if (!canImportReconciliation) {
        return
      }

      event.dataTransfer.dropEffect = 'copy'
      setIsDragActive(true)
    },
    [canImportReconciliation],
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
      if (!canImportReconciliation) {
        return
      }

      handleSelectedFile(event.dataTransfer.files.item(0))
    },
    [canImportReconciliation, handleSelectedFile],
  )

  const handleUpload = useCallback(async () => {
    if (!selectedFile || !batchId || !canImportReconciliation) {
      return
    }

    setIsUploading(true)
    setUploadError(null)
    setUploadSuccess(null)
    const uploadToastId = toast.loading('Uploading workbook...', {
      description: 'Validating and processing this batch revenue data.',
    })

    try {
      const formData = new FormData()
      formData.set('file', selectedFile)

      const response = await fetch(
        `/api/uploads/batches/${encodeURIComponent(batchId)}/reconciliation/import`,
        {
          method: 'POST',
          body: formData,
        },
      )

      const payload = (await response.json().catch(() => null)) as
        | (ReconciliationListView & { error?: string })
        | null
      const importedRowCount = Array.isArray(payload?.rows)
        ? payload.rows.length
        : 0

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
        description: `Imported ${importedRowCount} batch reconciliation rows successfully.`,
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
  }, [canImportReconciliation, refreshReconciliation, selectedFile, batchId])

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
    if (!batchId) {
      return
    }

    setIsExporting(true)

    try {
      const response = await fetch(
        `/api/uploads/batches/${encodeURIComponent(batchId)}/reconciliation/export`,
      )

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null

        throw new Error(
          payload?.error ||
            `Failed to export batch reconciliation workbook (${response.status}).`,
        )
      }

      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') ?? ''
      const fileNameMatch =
        disposition.match(/filename="([^"]+)"/i) ??
        disposition.match(/filename=([^;]+)/i)
      const fileName =
        fileNameMatch?.[1]?.trim() ?? 'Batch-Reconciliation-Report.xlsx'

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
          : 'Unable to export batch reconciliation workbook.',
      )
    } finally {
      setIsExporting(false)
    }
  }, [batchId])

  return (
    <section
      aria-labelledby="batch-reconciliation-heading"
      className="flex flex-col gap-4"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        disabled={!canImportReconciliation}
        onChange={(event) => {
          handleSelectedFile(event.target.files?.item(0) ?? null)
        }}
      />

      {!isClosedBatch ? (
        <Alert className={cn('rounded-lg bg-muted/20', PANEL_BORDER_CLASS)}>
          <IconAlertCircle />
          <AlertTitle>Close this batch to import revenue data.</AlertTitle>
          <AlertDescription>
            Revenue import is available after the upload batch is closed so
            matching uses a stable set of processed 2307 records.
          </AlertDescription>
        </Alert>
      ) : null}

      {loadError ? (
        <StatusBanner tone="danger">{loadError}</StatusBanner>
      ) : null}
      {uploadError ? (
        <StatusBanner tone="danger">{uploadError}</StatusBanner>
      ) : null}
      {uploadSuccess ? (
        <StatusBanner tone="success">{uploadSuccess}</StatusBanner>
      ) : null}
      {emailError ? (
        <StatusBanner tone="danger">{emailError}</StatusBanner>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
        <Card size="sm" className={PANEL_CARD_CLASS}>
          <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-2">
                <CardTitle
                  id="batch-reconciliation-heading"
                  className="text-sm"
                >
                  Import revenue data
                </CardTitle>
                <CardDescription className="max-w-2xl text-xs">
                  Bring in prepaid CWT records for this closed upload batch.
                  Re-importing replaces the current batch reconciliation rows.
                </CardDescription>
              </div>
              <Badge variant="outline">Excel workbook</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div
              className={cn(
                'flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center transition-colors',
                canImportReconciliation
                  ? 'cursor-pointer bg-muted/20 hover:bg-muted/30'
                  : 'cursor-not-allowed bg-muted/10 opacity-70',
                PANEL_BORDER_CLASS,
                isDragActive ? 'border-primary bg-primary/5' : undefined,
              )}
              onClick={() => {
                if (canImportReconciliation) {
                  inputRef.current?.click()
                }
              }}
              onDragOver={handleDropZoneDragOver}
              onDragLeave={handleDropZoneDragLeave}
              onDrop={handleDropZoneDrop}
            >
              <div
                className={cn(
                  'flex size-10 items-center justify-center rounded-md border bg-background text-muted-foreground',
                  PANEL_BORDER_CLASS,
                )}
              >
                <IconCloudUpload />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold text-foreground">
                  {selectedFile
                    ? 'Workbook ready for upload'
                    : 'Select sales report'}
                </p>
                <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
                  Drag and drop an Excel file here, or click to browse. Required
                  headers must match the reconciliation template.
                </p>
              </div>
              {selectedFile ? (
                <div
                  className={cn(
                    'rounded-lg border bg-background px-3 py-1.5 text-xs text-foreground',
                    PANEL_BORDER_CLASS,
                  )}
                >
                  {selectedFile.name}
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <DetailChip
                icon={IconFileSpreadsheet}
                label="Accepted formats"
                value=".xlsx and .xls"
              />
              <DetailChip
                icon={IconClockHour4}
                label="Workbook status"
                value={
                  isUploading
                    ? 'Uploading workbook'
                    : selectedFile
                      ? 'Ready to upload'
                      : 'Awaiting workbook'
                }
              />
              <DetailChip
                icon={IconReceipt2}
                label="Rows loaded"
                value={String(rows.length)}
              />
            </div>
          </CardContent>
          <CardFooter
            className={cn(
              'flex flex-wrap justify-end gap-2 border-t',
              PANEL_BORDER_CLASS,
            )}
          >
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={!canImportReconciliation || isUploading}
            >
              <IconFileSpreadsheet data-icon="inline-start" />
              Select file
            </Button>
            <Button
              type="button"
              onClick={() => void handleUpload()}
              disabled={!canImportReconciliation || !selectedFile || isUploading}
            >
              {isUploading ? (
                <IconLoader2
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <IconCloudUpload data-icon="inline-start" />
              )}
              {isUploading ? 'Uploading...' : 'Upload workbook'}
            </Button>
          </CardFooter>
        </Card>

        <Card size="sm" className={PANEL_CARD_CLASS}>
          <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
            <CardTitle className="text-sm">
              Batch reconciliation summary
            </CardTitle>
            <CardDescription className="text-xs">
              Current revenue matching health for this upload batch.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
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
          </CardContent>
          <CardFooter className={cn('border-t', PANEL_BORDER_CLASS)}>
            <div className="grid w-full gap-3 sm:grid-cols-3">
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
                icon={IconFileSpreadsheet}
                label="Workbook"
                value={selectedFileName}
              />
            </div>
          </CardFooter>
        </Card>
      </div>

      <Card
        size="sm"
        className={cn('flex min-h-[560px] flex-col', PANEL_CARD_CLASS)}
      >
        <CardHeader
          className={cn('shrink-0 gap-4 border-b', PANEL_BORDER_CLASS)}
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-sm">
                Batch reconciliation table
              </CardTitle>
              <CardDescription className="max-w-2xl text-xs">
                Compare imported revenue rows against 2307 records processed in
                this upload batch.
              </CardDescription>
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                disabled={!canExportSheet || rows.length === 0 || isExporting}
                onClick={() => void handleExport()}
              >
                <IconDownload data-icon="inline-start" />
                {isExporting ? 'Exporting...' : 'Export batch'}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {filteredRows.length === rows.length
                ? `${rows.length} total rows loaded`
                : `${filteredRows.length} of ${rows.length} rows in view`}
            </Badge>
            <Badge variant="outline">{matchRate}% matched</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          {isLoading ? (
            <div
              className={cn(
                'flex min-h-[240px] flex-1 items-center justify-center rounded-lg border border-dashed bg-muted/10 p-8 text-center text-sm text-muted-foreground',
                PANEL_BORDER_CLASS,
              )}
            >
              Loading batch reconciliation results...
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div
                className={cn(
                  'rounded-lg border bg-muted/20 p-3',
                  PANEL_BORDER_CLASS,
                )}
              >
                <FieldGroup className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,240px)_minmax(0,180px)_auto] xl:items-end">
                  <Field>
                    <FieldLabel htmlFor="batch-reconciliation-search">
                      Search
                    </FieldLabel>
                    <Input
                      id="batch-reconciliation-search"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search customer, TIN, invoice, or transaction line"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="batch-reconciliation-filter">
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
                        id="batch-reconciliation-filter"
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
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="batch-reconciliation-page-size">
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
                        id="batch-reconciliation-page-size"
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

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
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
                  density="compact"
                  selectedRowId={selectedId}
                  emailingCustomerGroupKey={emailingCustomerGroupKey}
                  emptyMessage={
                    rows.length === 0
                      ? 'No revenue data has been imported for this batch yet.'
                      : 'No batch reconciliation rows match the current search or filter.'
                  }
                  emptyDescription={
                    rows.length === 0
                      ? 'Import a revenue workbook after closing the batch to populate reconciliation results.'
                      : 'Clear the current filters to bring batch reconciliation results back into view.'
                  }
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

      {selectedRow ? (
        <ReconciliationDetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={selectedRow.customerName}
          subtitle={selectedRow.invoiceNumber}
          status={selectedRowStatus}
          meta={[
            {
              label: 'TIN',
              value: formatTinForDisplay(selectedRow.tin) || '—',
            },
            {
              label: 'Derived billing month',
              value: selectedRow.derivedBillingMonthMMYY,
            },
            {
              label: 'Accounting date',
              value: selectedRow.accountingDate ?? '—',
            },
            {
              label: 'Matched at',
              value: formatReconciliationTimestamp(selectedRow.matchedAt),
            },
            {
              label: 'No. of days uncollected',
              value: formatDaysUncollected(selectedRow.daysUncollected),
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
    </section>
  )
}
