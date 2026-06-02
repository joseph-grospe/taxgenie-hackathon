import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconDownload,
  IconSearch,
} from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import type { OperationalDocumentView } from '@/lib/documents-types'
import type {
  ValidatedDocumentFilterOptions,
  ValidatedDocumentPagination,
} from '@/lib/documents-server'
import type { ValidatedFilterSelections } from '@/lib/validated-filters'
import type {
  ValidatedRouteSearch,
  ValidatedSortBy,
  ValidatedSortDir,
} from '@/lib/validated-search-state'
import type { ValidatedTableRow } from '@/lib/validated-table-model'
import { filterValidatedRows } from '@/lib/validated-filters'
import {
  VALIDATED_PAGE_SIZE_OPTIONS,
  decodeCsv,
} from '@/lib/validated-search-state'
import { sortValidatedRows } from '@/lib/validated-sorters'
import {
  getMonthSortIndex,
  toValidatedTableRowsFromOperationalDocuments,
} from '@/lib/validated-table-model'
import { DocumentDetailDrawer } from '@/components/document-detail-drawer'
import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'

const PANEL_CARD_CLASS = 'border border-border/70 shadow-sm'
const PANEL_BORDER_CLASS = 'border-border/70'
const MULTIPLE_SELECT_VALUE = '__multiple__'

const compareText = (left: string, right: string) =>
  left.localeCompare(right, undefined, { sensitivity: 'base' })

const quarterToNumber = (quarter: string) => {
  const match = quarter.match(/^Q([1-4])$/i)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number.parseInt(match[1], 10)
}

const monthToNumber = (month: string) => {
  const monthIndex = getMonthSortIndex(month)
  return monthIndex < 0 ? Number.MAX_SAFE_INTEGER : monthIndex
}

function getFacetOptions(rows: Array<ValidatedTableRow>) {
  const year = Array.from(new Set(rows.map((row) => row.year))).sort(
    compareText,
  )

  const month = Array.from(new Set(rows.map((row) => row.month))).sort(
    (left, right) => monthToNumber(left) - monthToNumber(right),
  )

  const quarter = Array.from(new Set(rows.map((row) => row.quarter))).sort(
    (left, right) => quarterToNumber(left) - quarterToNumber(right),
  )

  const atc = Array.from(new Set(rows.map((row) => row.atc))).sort(compareText)

  return {
    year,
    month,
    quarter,
    atc,
  }
}

const getActiveFilterCount = (search: ValidatedRouteSearch) =>
  [search.q, search.year, search.month, search.customerName].filter(Boolean)
    .length +
  decodeCsv(search.quarter).length +
  decodeCsv(search.atc).length

type ValidatedDocumentsFilterBarProps = {
  rows: Array<ValidatedTableRow>
  filterOptions?: ValidatedDocumentFilterOptions
  search: ValidatedRouteSearch
  onSearchChange: (patch: Partial<ValidatedRouteSearch>) => void
}

export function ValidatedDocumentsFilterBar({
  rows,
  filterOptions,
  search,
  onSearchChange,
}: ValidatedDocumentsFilterBarProps) {
  const derivedFacetOptions = useMemo(() => getFacetOptions(rows), [rows])
  const facetOptions = filterOptions ?? derivedFacetOptions

  const updateSearch = (patch: Partial<ValidatedRouteSearch>) =>
    onSearchChange(patch)

  const clearAllFilters = () => {
    updateSearch({
      q: '',
      year: '',
      month: '',
      quarter: '',
      entity: '',
      customerType: '',
      customerName: '',
      errorType: '',
      atc: '',
    })
  }

  const getCsvSelectValue = (value: string) => {
    const values = decodeCsv(value)
    if (values.length === 0) return 'all'
    return values.length === 1 ? values[0] : MULTIPLE_SELECT_VALUE
  }

  const toFilterValue = (value: string | null) =>
    value && value !== 'all' && value !== MULTIPLE_SELECT_VALUE ? value : ''

  return (
    <div className="flex flex-col gap-3">
      <FieldGroup className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1.3fr)_minmax(8rem,0.65fr)_minmax(9rem,0.75fr)_minmax(8rem,0.65fr)_minmax(9rem,0.75fr)]">
        <Field>
          <FieldLabel htmlFor="validated-search" className="text-xs">
            Search
          </FieldLabel>
          <div className="relative min-w-0">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="validated-search"
              value={search.q}
              className="pl-9"
              placeholder="File, customer, ATC"
              onChange={(event) =>
                updateSearch({ q: event.currentTarget.value })
              }
            />
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="validated-year" className="text-xs">
            Year
          </FieldLabel>
          <Select
            value={search.year || 'all'}
            onValueChange={(value: string | null) =>
              updateSearch({ year: toFilterValue(value) })
            }
          >
            <SelectTrigger id="validated-year" className="w-full">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                <SelectItem value="all">All years</SelectItem>
                {facetOptions.year.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="validated-month" className="text-xs">
            Month
          </FieldLabel>
          <Select
            value={search.month || 'all'}
            onValueChange={(value: string | null) =>
              updateSearch({ month: toFilterValue(value) })
            }
          >
            <SelectTrigger id="validated-month" className="w-full">
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                <SelectItem value="all">All months</SelectItem>
                {facetOptions.month.map((month) => (
                  <SelectItem key={month} value={month}>
                    {month}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="validated-quarter" className="text-xs">
            Quarter
          </FieldLabel>
          <Select
            value={getCsvSelectValue(search.quarter)}
            onValueChange={(value: string | null) =>
              updateSearch({ quarter: toFilterValue(value) })
            }
          >
            <SelectTrigger id="validated-quarter" className="w-full">
              <SelectValue placeholder="Quarter" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                <SelectItem value="all">All quarters</SelectItem>
                <SelectItem value={MULTIPLE_SELECT_VALUE} disabled>
                  Multiple selected
                </SelectItem>
                {facetOptions.quarter.map((quarter) => (
                  <SelectItem key={quarter} value={quarter}>
                    {quarter}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="validated-atc" className="text-xs">
            ATC
          </FieldLabel>
          <Select
            value={getCsvSelectValue(search.atc)}
            onValueChange={(value: string | null) =>
              updateSearch({ atc: toFilterValue(value) })
            }
          >
            <SelectTrigger id="validated-atc" className="w-full">
              <SelectValue placeholder="ATC" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                <SelectItem value="all">All ATC</SelectItem>
                <SelectItem value={MULTIPLE_SELECT_VALUE} disabled>
                  Multiple selected
                </SelectItem>
                {facetOptions.atc.map((atc) => (
                  <SelectItem key={atc} value={atc}>
                    {atc}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>

      {getActiveFilterCount(search) > 0 ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearAllFilters}
          >
            Clear filters
          </Button>
        </div>
      ) : null}
    </div>
  )
}
type ValidatedDocumentsPanelProps = {
  search: ValidatedRouteSearch
  onSearchChange: (patch: Partial<ValidatedRouteSearch>) => void
  rows?: Array<ValidatedTableRow>
  documents?: Array<OperationalDocumentView>
  actions?: ReactNode
  showControls?: boolean
  pagination?: ValidatedDocumentPagination
  filterOptions?: ValidatedDocumentFilterOptions
  loading?: boolean
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  canDownloadSignedPdf?: boolean
}

export function ValidatedDocumentsPanel({
  search,
  onSearchChange,
  rows,
  documents,
  actions,
  showControls = true,
  pagination,
  filterOptions,
  loading = false,
  onPageChange,
  onPageSizeChange,
  canDownloadSignedPdf = false,
}: ValidatedDocumentsPanelProps) {
  const [selectedId, setSelectedId] = useState(() => documents?.[0]?.id ?? '')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const tableRows = useMemo(
    () =>
      rows !== undefined
        ? rows
        : documents !== undefined
          ? toValidatedTableRowsFromOperationalDocuments(documents)
          : [],
    [documents, rows],
  )

  useEffect(() => {
    if (tableRows.length === 0) {
      setSelectedId('')
      setDrawerOpen(false)
      return
    }

    if (!tableRows.some((row) => row.docId === selectedId)) {
      setSelectedId(tableRows[0].docId)
    }
  }, [selectedId, tableRows])

  const filterSelections = useMemo<ValidatedFilterSelections>(
    () => ({
      q: search.q,
      year: search.year,
      month: search.month,
      quarter: decodeCsv(search.quarter),
      entity: search.entity,
      customerType: [],
      customerName: search.customerName,
      errorType: [],
      atc: decodeCsv(search.atc),
    }),
    [search],
  )

  const serverFiltered = pagination !== undefined
  const displayedRows = useMemo(() => {
    if (serverFiltered) return tableRows

    const filtered = filterValidatedRows(tableRows, filterSelections)
    return sortValidatedRows(filtered, {
      sortBy: search.sortBy,
      sortDir: search.sortDir,
    })
  }, [
    filterSelections,
    search.sortBy,
    search.sortDir,
    serverFiltered,
    tableRows,
  ])

  const selectedOperationalDocument =
    documents !== undefined && documents.length > 0
      ? (documents.find((doc) => doc.id === selectedId) ?? documents[0])
      : null

  const isSortActive = (sortBy: ValidatedSortBy) =>
    search.sortBy === sortBy ||
    (sortBy === 'customer' && search.sortBy === 'customerName')

  const sortIndicator = (sortBy: ValidatedSortBy) => {
    if (!isSortActive(sortBy)) return null
    return search.sortDir === 'asc' ? (
      <IconChevronUp className="size-3" />
    ) : (
      <IconChevronDown className="size-3" />
    )
  }

  const defaultSortDir = (sortBy: ValidatedSortBy): ValidatedSortDir =>
    sortBy === 'amount' ? 'desc' : 'asc'

  const handleSortChange = (sortBy: ValidatedSortBy) => {
    if (isSortActive(sortBy)) {
      onSearchChange({
        sortBy,
        sortDir: search.sortDir === 'asc' ? 'desc' : 'asc',
      })
      return
    }

    onSearchChange({
      sortBy,
      sortDir: defaultSortDir(sortBy),
    })
  }

  const renderSortableHeader = (
    sortBy: ValidatedSortBy,
    label: string,
    alignRight = false,
  ) => (
    <TableHead
      aria-sort={
        isSortActive(sortBy)
          ? search.sortDir === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
      className={cn('h-8 bg-muted/35 px-2', alignRight && 'text-right')}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="h-6 gap-1 px-1 text-xs"
        onClick={() => handleSortChange(sortBy)}
      >
        {label}
        {sortIndicator(sortBy)}
      </Button>
    </TableHead>
  )

  const documentById = useMemo(
    () => new Map((documents ?? []).map((document) => [document.id, document])),
    [documents],
  )
  const startRow =
    pagination && pagination.totalItems > 0 && displayedRows.length > 0
      ? (pagination.page - 1) * pagination.pageSize + 1
      : 0
  const endRow = pagination
    ? Math.min(pagination.page * pagination.pageSize, pagination.totalItems)
    : displayedRows.length
  const totalRows = pagination?.totalItems ?? displayedRows.length
  const activeFilterCount = getActiveFilterCount(search)

  return (
    <Card size="sm" className={PANEL_CARD_CLASS}>
      <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm">Validated documents</CardTitle>
              <Badge variant="outline">{totalRows.toLocaleString()} rows</Badge>
              {activeFilterCount > 0 ? (
                <Badge variant="secondary">{activeFilterCount} filters</Badge>
              ) : null}
            </div>
            <CardDescription className="text-xs">
              Search, filter, and sort validated records.
            </CardDescription>
          </div>
          {actions ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </div>
        {showControls ? (
          <ValidatedDocumentsFilterBar
            rows={tableRows}
            filterOptions={filterOptions}
            search={search}
            onSearchChange={onSearchChange}
          />
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          className={cn(
            'overflow-x-auto rounded-lg border bg-background',
            PANEL_BORDER_CLASS,
          )}
        >
          <Table className="min-w-[1040px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
            <TableHeader className="[&_tr]:border-border/70">
              <TableRow className="bg-muted/35 hover:bg-muted/35">
                <TableHead className="w-[18rem] bg-muted/35">File</TableHead>
                {renderSortableHeader('entity', 'Entity')}
                {renderSortableHeader('customer', 'Customer')}
                {renderSortableHeader('year', 'Year')}
                {renderSortableHeader('month', 'Month')}
                {renderSortableHeader('quarter', 'Quarter')}
                {renderSortableHeader('atc', 'ATC')}
                {renderSortableHeader('amount', 'Tax Withheld', true)}
                <TableHead className="bg-muted/35">Confidence</TableHead>
                <TableHead className="bg-muted/35">Status</TableHead>
                <TableHead className="bg-muted/35">Signing</TableHead>
                <TableHead className="bg-muted/35 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b-0">
              {displayedRows.map((doc) => {
                const operationalDocument = documentById.get(doc.docId)

                return (
                  <TableRow
                    key={doc.docId}
                    tabIndex={0}
                    onClick={() => {
                      setSelectedId(doc.docId)
                      setDrawerOpen(true)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedId(doc.docId)
                        setDrawerOpen(true)
                      }
                    }}
                    className="cursor-pointer border-border/70 bg-background hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    title="View validated document details"
                  >
                    <TableCell className="max-w-[18rem] truncate font-medium">
                      {doc.fileName}
                    </TableCell>
                    <TableCell className="max-w-[8rem] truncate">
                      {doc.entity}
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate">
                      {doc.customerName}
                    </TableCell>
                    <TableCell>{doc.year}</TableCell>
                    <TableCell>{doc.month}</TableCell>
                    <TableCell>{doc.quarter}</TableCell>
                    <TableCell>{doc.atc}</TableCell>
                    <TableCell className="text-right font-medium">
                      {doc.taxWithheld}
                    </TableCell>
                    <TableCell>{doc.confidence}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill status={doc.status} />
                        {operationalDocument?.override?.status ===
                        'approved' ? (
                          <Badge variant="secondary">Override</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {operationalDocument?.kind === 'certificate' ? (
                        <Badge variant="outline">
                          {operationalDocument.signingStatus === 'signed'
                            ? 'Signed'
                            : operationalDocument.signingStatus === 'failed'
                              ? 'Failed'
                              : 'Unsigned'}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {operationalDocument?.uploadBatchId &&
                      operationalDocument.canSign &&
                      operationalDocument.signingStatus !== 'signed' ? (
                        <Link
                          to="/upload/batches/$batchId/sign"
                          params={{
                            batchId: operationalDocument.uploadBatchId,
                          }}
                          className={buttonVariants({
                            size: 'xs',
                            variant: 'outline',
                          })}
                          onClick={(event) => event.stopPropagation()}
                        >
                          Sign
                        </Link>
                      ) : operationalDocument?.uploadBatchId &&
                        operationalDocument.signingStatus === 'signed' &&
                        operationalDocument.signedPdfUrl &&
                        canDownloadSignedPdf ? (
                        <a
                          href={`/api/documents/${encodeURIComponent(
                            operationalDocument.id,
                          )}/signed-pdf`}
                          className={buttonVariants({
                            size: 'xs',
                            variant: 'outline',
                          })}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <IconDownload data-icon="inline-start" />
                          Download
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {displayedRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {loading
                      ? 'Loading validated documents...'
                      : 'No validated documents match the current filters.'}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        {pagination ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {startRow}-{endRow} of{' '}
              {pagination.totalItems.toLocaleString()} rows
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(pagination.pageSize)}
                onValueChange={(value: string | null) => {
                  if (value) {
                    onPageSizeChange?.(Number.parseInt(value, 10))
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
                    {VALIDATED_PAGE_SIZE_OPTIONS.map((pageSize) => (
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
                disabled={!pagination.hasPreviousPage || loading}
                onClick={() => onPageChange?.(Math.max(1, pagination.page - 1))}
              >
                <IconChevronLeft data-icon="inline-start" />
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!pagination.hasNextPage || loading}
                onClick={() => onPageChange?.(pagination.page + 1)}
              >
                Next
                <IconChevronRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
      {selectedOperationalDocument ? (
        <DocumentDetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={selectedOperationalDocument.fileName}
          subtitle={selectedOperationalDocument.period}
          status={selectedOperationalDocument.status}
          stage={selectedOperationalDocument.stage}
          nextStep={selectedOperationalDocument.nextStep}
          trail={selectedOperationalDocument.trail}
          confidence={selectedOperationalDocument.confidence}
          atc={selectedOperationalDocument.atc}
          payee={selectedOperationalDocument.payee}
          meta={[
            { label: 'Period', value: selectedOperationalDocument.period },
            { label: 'Tax Base', value: selectedOperationalDocument.taxBase },
            {
              label: 'Tax Withheld',
              value: selectedOperationalDocument.taxWithheld,
            },
            { label: 'Updated', value: selectedOperationalDocument.updatedAt },
          ]}
          processing={selectedOperationalDocument.processing}
          logs={selectedOperationalDocument.logs}
          errors={selectedOperationalDocument.errors}
          openTo={`/documents/${selectedOperationalDocument.id}`}
        />
      ) : null}
    </Card>
  )
}
