import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconDownload,
  IconEdit,
  IconEye,
  IconLock,
  IconRefresh,
  IconSearch,
  IconSignature,
} from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { FormEvent, ReactNode } from 'react'

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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
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
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { getProductTourTargetProps } from '@/lib/product-tours'

const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'
const PANEL_BORDER_CLASS = 'border-border/60'
const MULTIPLE_SELECT_VALUE = '__multiple__'
const BLANK_SELECT_VALUE = '__blank__'
const MONTH_OF_QUARTER_OPTIONS = [
  { value: 'first', label: 'First' },
  { value: 'second', label: 'Second' },
  { value: 'third', label: 'Third' },
] as const

type EditableReviewField = OperationalDocumentView['reviewFields'][number] & {
  key: string
}

type ExtractedFieldFilter = 'all' | 'edited'

type ExtractedFieldSectionId =
  | 'certificate'
  | 'parties'
  | 'amounts'
  | 'signatory'
  | 'other'

const EXTRACTED_FIELD_SECTIONS: Array<{
  id: ExtractedFieldSectionId
  label: string
  keys: Array<string>
}> = [
  {
    id: 'certificate',
    label: 'Certificate',
    keys: ['periodStart', 'periodEnd', 'monthOfQuarter', 'atcCode'],
  },
  {
    id: 'parties',
    label: 'Parties',
    keys: ['payeeName', 'payeeTin', 'payorName', 'payorTin'],
  },
  {
    id: 'amounts',
    label: 'Amounts',
    keys: ['taxBase', 'taxWithheld'],
  },
  {
    id: 'signatory',
    label: 'Signatory',
    keys: [
      'printedName',
      'signatoryTitle',
      'signatoryTin',
      'signaturePresent',
      'companyName',
    ],
  },
  {
    id: 'other',
    label: 'Other fields',
    keys: [],
  },
]

const extractedFieldSectionByKey = new Map<string, ExtractedFieldSectionId>(
  EXTRACTED_FIELD_SECTIONS.flatMap((section) =>
    section.keys.map((key) => [key, section.id] as const),
  ),
)

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
  canAccessSigning?: boolean
  onDocumentUpdated?: (
    document: OperationalDocumentView,
  ) => void | Promise<void>
  tourTargets?: {
    filters?: string
    pagination?: string
    table?: string
  }
}

const getOptionalTourTargetProps = (targetId?: string) =>
  targetId ? getProductTourTargetProps(targetId) : {}

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
  canAccessSigning = false,
  onDocumentUpdated,
  tourTargets,
}: ValidatedDocumentsPanelProps) {
  const [selectedId, setSelectedId] = useState(() => documents?.[0]?.id ?? '')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
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
  const editingDocument = editingId
    ? (documentById.get(editingId) ?? null)
    : null
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
          <div {...getOptionalTourTargetProps(tourTargets?.filters)}>
            <ValidatedDocumentsFilterBar
              rows={tableRows}
              filterOptions={filterOptions}
              search={search}
              onSearchChange={onSearchChange}
            />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          className={cn(
            'overflow-x-auto rounded-lg border bg-background',
            PANEL_BORDER_CLASS,
          )}
          {...getOptionalTourTargetProps(tourTargets?.table)}
        >
          <Table className="min-w-[1040px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
            <TableHeader className="[&_tr]:border-border/60">
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
                    className="cursor-pointer border-border/60 bg-background hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                        {operationalDocument?.extractedFieldsEdit ? (
                          <Badge variant="outline">Edited</Badge>
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
                      {operationalDocument ? (
                        <ValidatedDocumentActionButtons
                          document={operationalDocument}
                          canAccessSigning={canAccessSigning}
                          canDownloadSignedPdf={canDownloadSignedPdf}
                          canEditExtractedFields={Boolean(
                            operationalDocument.canEditExtractedFields,
                          )}
                          onEdit={() => setEditingId(operationalDocument.id)}
                        />
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
          <div
            className="flex flex-wrap items-center justify-between gap-3"
            {...getOptionalTourTargetProps(tourTargets?.pagination)}
          >
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
          reviewFields={selectedOperationalDocument.reviewFields}
          openTo={`/documents/${selectedOperationalDocument.id}`}
        />
      ) : null}
      <ExtractedFieldsEditSheet
        open={Boolean(editingDocument)}
        document={editingDocument}
        onOpenChange={(open) => {
          if (!open) {
            setEditingId('')
          }
        }}
        onSaved={async (document) => {
          await onDocumentUpdated?.(document)
          setEditingId('')
        }}
      />
    </Card>
  )
}

function ActionIconTooltip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent align="end">{label}</TooltipContent>
    </Tooltip>
  )
}

function getEditDisabledReason(document: OperationalDocumentView) {
  if (document.kind !== 'certificate') {
    return 'Only validated certificates can be edited.'
  }

  if (document.signingStatus === 'signed') {
    return 'Signed certificates cannot be edited.'
  }

  return ''
}

export function getValidatedDocumentActionState({
  document,
  canAccessSigning,
  canDownloadSignedPdf,
  canEditExtractedFields,
}: {
  document: OperationalDocumentView
  canAccessSigning: boolean
  canDownloadSignedPdf: boolean
  canEditExtractedFields: boolean
}) {
  const showSign =
    Boolean(document.uploadBatchId) &&
    document.canSign &&
    canAccessSigning &&
    document.signingStatus !== 'signed'
  const showDownload =
    Boolean(document.uploadBatchId) &&
    document.signingStatus === 'signed' &&
    Boolean(document.signedPdfUrl) &&
    canDownloadSignedPdf
  const showEdit = canEditExtractedFields && document.kind === 'certificate'
  const editDisabledReason = showEdit ? getEditDisabledReason(document) : ''

  return {
    showView: true,
    showSign,
    showDownload,
    showEdit,
    editDisabledReason,
    hasActions: true,
  }
}

function ValidatedDocumentActionButtons({
  document,
  canAccessSigning,
  canDownloadSignedPdf,
  canEditExtractedFields,
  onEdit,
}: {
  document: OperationalDocumentView
  canAccessSigning: boolean
  canDownloadSignedPdf: boolean
  canEditExtractedFields: boolean
  onEdit: () => void
}) {
  const {
    showView,
    showSign,
    showDownload,
    showEdit,
    editDisabledReason,
    hasActions,
  } = getValidatedDocumentActionState({
    document,
    canAccessSigning,
    canDownloadSignedPdf,
    canEditExtractedFields,
  })

  if (!hasActions) {
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {showView ? (
        <ActionIconTooltip label="View document details">
          <Link
            to="/documents/$docId"
            params={{ docId: document.id }}
            aria-label="View document details"
            className={buttonVariants({
              size: 'icon-xs',
              variant: 'outline',
            })}
            onClick={(event) => event.stopPropagation()}
          >
            <IconEye />
          </Link>
        </ActionIconTooltip>
      ) : null}

      {showDownload ? (
        <ActionIconTooltip label="Download signed PDF">
          <a
            href={`/api/documents/${encodeURIComponent(document.id)}/signed-pdf`}
            aria-label="Download signed PDF"
            className={buttonVariants({
              size: 'icon-xs',
              variant: 'outline',
            })}
            onClick={(event) => event.stopPropagation()}
          >
            <IconDownload />
          </a>
        </ActionIconTooltip>
      ) : null}

      {showSign && document.uploadBatchId ? (
        <ActionIconTooltip label="Sign">
          <Link
            to="/upload/batches/$batchId/sign"
            params={{ batchId: document.uploadBatchId }}
            aria-label="Sign"
            className={buttonVariants({
              size: 'icon-xs',
              variant: 'outline',
            })}
            onClick={(event) => event.stopPropagation()}
          >
            <IconSignature />
          </Link>
        </ActionIconTooltip>
      ) : null}

      {showEdit ? (
        <ActionIconTooltip
          label={editDisabledReason || 'Edit extracted fields'}
        >
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            aria-label="Edit extracted fields"
            disabled={Boolean(editDisabledReason)}
            onClick={(event) => {
              event.stopPropagation()
              onEdit()
            }}
          >
            <IconEdit />
          </Button>
        </ActionIconTooltip>
      ) : null}
    </div>
  )
}

const getFieldInputValue = (field: EditableReviewField) => {
  if (field.key === 'periodStart' || field.key === 'periodEnd') {
    return toDateInputValue(field.rawValue ?? field.value)
  }

  if (field.key === 'monthOfQuarter') {
    return toMonthOfQuarterInputValue(field.rawValue ?? field.value)
  }

  if (field.rawValue === null || typeof field.rawValue === 'undefined') {
    return field.value === '—' ? '' : field.value
  }

  return String(field.rawValue)
}

const toMonthOfQuarterInputValue = (value: unknown) => {
  const normalized =
    typeof value === 'string'
      ? value.trim().toLowerCase()
      : String(value ?? '')
          .trim()
          .toLowerCase()
  return MONTH_OF_QUARTER_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : ''
}

const toDateInputValue = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '')
  if (!text || text === '—') return ''

  const compactUsMatch = text.match(/^(\d{2})(\d{2})[/\s-](\d{4})$/)
  if (compactUsMatch) {
    return `${compactUsMatch[3]}-${compactUsMatch[1]}-${compactUsMatch[2]}`
  }

  const usMatch = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/)
  if (usMatch) {
    return `${usMatch[3]}-${usMatch[1]}-${usMatch[2]}`
  }

  const isoMatch = text.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/)
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return ''

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getPeriodCoveredBoundaryInputValue = (
  value: unknown,
  boundary: 'start' | 'end',
) => {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '')
  if (!text || text === '—') return ''

  const rangeMatch =
    text.match(/^(.+?)\s+to\s+(.+)$/i) ?? text.match(/^(.+?)\s+-\s+(.+)$/)
  if (!rangeMatch) {
    return boundary === 'end' ? toDateInputValue(text) : ''
  }

  return toDateInputValue(boundary === 'start' ? rangeMatch[1] : rangeMatch[2])
}

const toEditableReviewField = (
  field: OperationalDocumentView['reviewFields'][number],
): EditableReviewField | null => {
  if (!field.key) {
    return null
  }

  if (field.key === 'periodCovered') {
    return {
      ...field,
      key: 'periodStart',
      label: 'Period start',
      rawValue: getPeriodCoveredBoundaryInputValue(field.rawValue, 'start'),
      value: getPeriodCoveredBoundaryInputValue(field.value, 'start'),
      originalValue: field.originalValue
        ? getPeriodCoveredBoundaryInputValue(field.originalValue, 'start')
        : undefined,
    }
  }

  if (field.key === 'periodEnd') {
    return {
      ...field,
      key: 'periodEnd',
      rawValue: toDateInputValue(field.rawValue ?? field.value),
      value: toDateInputValue(field.value),
      originalValue: field.originalValue
        ? toDateInputValue(field.originalValue)
        : undefined,
    }
  }

  return field as EditableReviewField
}

export const toEditableReviewFields = (
  document: OperationalDocumentView | null,
) =>
  (document?.reviewFields ?? []).flatMap((field) => {
    const editableField = toEditableReviewField(field)
    return editableField ? [editableField] : []
  })

export function getExtractedFieldsInitialValues(
  fields: Array<EditableReviewField>,
) {
  return Object.fromEntries(
    fields.map((field) => [field.key, getFieldInputValue(field)]),
  )
}

export function getExtractedFieldsEditState({
  fields,
  values,
  initialValues,
}: {
  fields: Array<EditableReviewField>
  values: Record<string, string>
  initialValues: Record<string, string>
}) {
  const changedFields: Record<string, string> = {}
  const changedFieldKeys = new Set<string>()
  const editedFieldKeys = new Set<string>()

  for (const field of fields) {
    const initialValue = initialValues[field.key] ?? getFieldInputValue(field)
    const value = values[field.key] ?? initialValue

    if (value !== initialValue) {
      changedFields[field.key] = value
      changedFieldKeys.add(field.key)
    }

    if (field.source === 'edited') {
      editedFieldKeys.add(field.key)
    }
  }

  const reviewFieldKeys = new Set([...changedFieldKeys, ...editedFieldKeys])

  return {
    changedFields,
    changedFieldKeys,
    changedCount: changedFieldKeys.size,
    editedFieldKeys,
    editedCount: editedFieldKeys.size,
    hasChanges: changedFieldKeys.size > 0,
    reviewFieldCount: reviewFieldKeys.size,
  }
}

export function getGroupedExtractedFieldSections({
  fields,
  filter,
  changedFieldKeys,
}: {
  fields: Array<EditableReviewField>
  filter: ExtractedFieldFilter
  changedFieldKeys: Set<string>
}) {
  const fieldsBySection = new Map<
    ExtractedFieldSectionId,
    Array<EditableReviewField>
  >(EXTRACTED_FIELD_SECTIONS.map((section) => [section.id, []]))

  for (const field of fields) {
    const shouldInclude =
      filter === 'all' ||
      field.source === 'edited' ||
      changedFieldKeys.has(field.key)

    if (!shouldInclude) {
      continue
    }

    const sectionId = extractedFieldSectionByKey.get(field.key) ?? 'other'
    fieldsBySection.get(sectionId)?.push(field)
  }

  return EXTRACTED_FIELD_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    fields: fieldsBySection.get(section.id) ?? [],
  })).filter((section) => section.fields.length > 0)
}

const formatEditedFieldCount = (count: number) =>
  `${count} edited ${count === 1 ? 'field' : 'fields'}`

const formatUnsavedChangeCount = (count: number) =>
  `${count} unsaved ${count === 1 ? 'change' : 'changes'}`

const formatPreviousFieldValue = (field: EditableReviewField) => {
  const value = field.originalValue?.trim()
  return value && value !== '—' ? value : 'Blank'
}

const formatLastEditedLabel = (
  edit: OperationalDocumentView['extractedFieldsEdit'],
) => {
  if (!edit?.editedAt) {
    return ''
  }

  return edit.editedByName
    ? `Last edited by ${edit.editedByName} on ${edit.editedAt}`
    : `Last edited on ${edit.editedAt}`
}

function ExtractedFieldsEditSheet({
  open,
  document,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  document: OperationalDocumentView | null
  onOpenChange: (open: boolean) => void
  onSaved: (document: OperationalDocumentView) => void | Promise<void>
}) {
  const editableFields = useMemo(
    () => toEditableReviewFields(document),
    [document],
  )
  const initialValues = useMemo(
    () => getExtractedFieldsInitialValues(editableFields),
    [editableFields],
  )
  const documentId = document?.id ?? null
  const initializedDocumentIdRef = useRef<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [fieldFilter, setFieldFilter] = useState<ExtractedFieldFilter>('all')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !documentId) {
      initializedDocumentIdRef.current = null
      return
    }

    if (initializedDocumentIdRef.current === documentId) {
      return
    }

    initializedDocumentIdRef.current = documentId
    setValues(initialValues)
    setFieldFilter('all')
    setError(null)
  }, [documentId, initialValues, open])

  if (!document) {
    return null
  }

  const editState = getExtractedFieldsEditState({
    fields: editableFields,
    values,
    initialValues,
  })
  const effectiveFieldFilter =
    editState.reviewFieldCount > 0 ? fieldFilter : 'all'
  const groupedSections = getGroupedExtractedFieldSections({
    fields: editableFields,
    filter: effectiveFieldFilter,
    changedFieldKeys: editState.changedFieldKeys,
  })
  const isReadOnly = document.signingStatus === 'signed'
  const editMeta = document.extractedFieldsEdit ?? null
  const lastEditedLabel = formatLastEditedLabel(editMeta)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editState.hasChanges || isSaving || isReadOnly) return

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(document.id)}/extracted-fields`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(editState.changedFields),
        },
      )
      const payload = (await response.json().catch(() => null)) as {
        document?: OperationalDocumentView
        error?: string
      } | null

      if (!response.ok || !payload?.document) {
        throw new Error(
          payload?.error ||
            `Failed to update extracted fields (${response.status}).`,
        )
      }

      await onSaved(payload.document)
      toast.success('Extracted fields updated.')
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to update extracted fields.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="overflow-hidden"
        style={{ width: 'min(100vw, 56rem)', maxWidth: '100vw' }}
      >
        <SheetHeader className="border-b border-border/60 pr-14">
          <div className="flex flex-col gap-3">
            <div className="min-w-0">
              <SheetTitle>Edit extracted fields</SheetTitle>
              <SheetDescription className="truncate">
                {document.fileName}
              </SheetDescription>
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <span className="truncate">Period: {document.period}</span>
              <span className="truncate">Payee: {document.payee}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Validated</Badge>
              <Badge variant="outline">
                {document.signingStatus === 'signed'
                  ? 'Signed'
                  : document.signingStatus === 'failed'
                    ? 'Signing failed'
                    : 'Unsigned'}
              </Badge>
              {editState.editedCount > 0 ? (
                <Badge variant="outline">
                  {formatEditedFieldCount(editState.editedCount)}
                </Badge>
              ) : null}
              {editState.hasChanges ? (
                <Badge variant="secondary">
                  {formatUnsavedChangeCount(editState.changedCount)}
                </Badge>
              ) : null}
            </div>
            {lastEditedLabel ? (
              <p className="text-xs text-muted-foreground">{lastEditedLabel}</p>
            ) : null}
          </div>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Correction fields</p>
                <p className="text-xs text-muted-foreground">
                  Update the extracted values that should be used in lists,
                  details, filters, and exports.
                </p>
              </div>
              {editState.reviewFieldCount > 0 ? (
                <ToggleGroup
                  aria-label="Field correction filter"
                  value={[effectiveFieldFilter]}
                  onValueChange={(items) => {
                    const next = items.at(-1)
                    if (next === 'all' || next === 'edited') {
                      setFieldFilter(next)
                    }
                  }}
                  variant="outline"
                  size="sm"
                >
                  <ToggleGroupItem value="all">All fields</ToggleGroupItem>
                  <ToggleGroupItem value="edited">Edited only</ToggleGroupItem>
                </ToggleGroup>
              ) : null}
            </div>
            {isReadOnly ? (
              <Alert className="mb-4">
                <IconLock />
                <AlertDescription>
                  This certificate is signed, so extracted fields are view-only.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-4">
              {groupedSections.map((section) => (
                <FieldSet
                  key={section.id}
                  className="gap-3 rounded-md border border-border/60 p-3"
                >
                  <FieldLegend className="mb-0 text-sm">
                    {section.label}
                  </FieldLegend>
                  <FieldGroup className="grid gap-3 sm:grid-cols-2">
                    {section.fields.map((field) => {
                      const fieldValue =
                        values[field.key] ?? initialValues[field.key]
                      const isDirty = editState.changedFieldKeys.has(field.key)
                      const isEdited = field.source === 'edited'
                      const controlId = `extracted-field-${field.key}`

                      return (
                        <Field
                          key={field.key}
                          className={cn(
                            'gap-2 rounded-md border border-l-2 border-border/60 border-l-transparent bg-background p-3 transition-colors',
                            isDirty &&
                              'border-primary/40 border-l-primary bg-primary/5',
                          )}
                        >
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              {isDirty ? (
                                <span
                                  aria-label="Unsaved change"
                                  className="size-1.5 shrink-0 rounded-full bg-primary"
                                />
                              ) : null}
                              <FieldLabel
                                htmlFor={controlId}
                                className="truncate"
                              >
                                {field.label}
                              </FieldLabel>
                            </div>
                            {isEdited ? (
                              <Badge variant="secondary">Edited</Badge>
                            ) : null}
                          </div>
                          {field.key === 'signaturePresent' ? (
                            <Select
                              value={fieldValue || BLANK_SELECT_VALUE}
                              disabled={isSaving || isReadOnly}
                              onValueChange={(value: string | null) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.key]:
                                    value && value !== BLANK_SELECT_VALUE
                                      ? value
                                      : '',
                                }))
                              }
                            >
                              <SelectTrigger id={controlId} className="w-full">
                                <SelectValue placeholder="Blank" />
                              </SelectTrigger>
                              <SelectContent align="start">
                                <SelectGroup>
                                  <SelectItem value={BLANK_SELECT_VALUE}>
                                    Blank
                                  </SelectItem>
                                  <SelectItem value="true">Yes</SelectItem>
                                  <SelectItem value="false">No</SelectItem>
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          ) : field.key === 'monthOfQuarter' ? (
                            <Select
                              value={fieldValue || BLANK_SELECT_VALUE}
                              disabled={isSaving || isReadOnly}
                              onValueChange={(value: string | null) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.key]:
                                    value && value !== BLANK_SELECT_VALUE
                                      ? value
                                      : '',
                                }))
                              }
                            >
                              <SelectTrigger id={controlId} className="w-full">
                                <SelectValue placeholder="Blank" />
                              </SelectTrigger>
                              <SelectContent align="start">
                                <SelectGroup>
                                  <SelectItem value={BLANK_SELECT_VALUE}>
                                    Blank
                                  </SelectItem>
                                  {MONTH_OF_QUARTER_OPTIONS.map((option) => (
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
                          ) : field.key === 'periodStart' ||
                            field.key === 'periodEnd' ? (
                            <Input
                              id={controlId}
                              type="date"
                              value={fieldValue}
                              disabled={isSaving || isReadOnly}
                              onChange={(event) => {
                                const value = event.currentTarget.value
                                setValues((current) => ({
                                  ...current,
                                  [field.key]: value,
                                }))
                              }}
                            />
                          ) : (
                            <Input
                              id={controlId}
                              value={fieldValue}
                              disabled={isSaving || isReadOnly}
                              onChange={(event) => {
                                const value = event.currentTarget.value
                                setValues((current) => ({
                                  ...current,
                                  [field.key]: value,
                                }))
                              }}
                            />
                          )}
                          {isEdited ? (
                            <FieldDescription className="text-xs">
                              Previous value: {formatPreviousFieldValue(field)}
                            </FieldDescription>
                          ) : null}
                        </Field>
                      )
                    })}
                  </FieldGroup>
                </FieldSet>
              ))}
            </div>
            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <SheetFooter className="border-t border-border/60 bg-background sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {editState.hasChanges
                ? formatUnsavedChangeCount(editState.changedCount)
                : 'No unsaved changes'}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setValues(initialValues)}
                disabled={!editState.hasChanges || isSaving || isReadOnly}
              >
                <IconRefresh data-icon="inline-start" />
                Reset changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!editState.hasChanges || isSaving || isReadOnly}
              >
                {isSaving ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
