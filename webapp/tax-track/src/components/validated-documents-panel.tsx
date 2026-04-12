import {
  IconCalendar,
  IconChevronDown,
  IconChevronUp,
  IconFilter,
  IconX,
} from '@tabler/icons-react'
import { format } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DateRange } from 'react-day-picker'

import type { OperationalDocumentView } from '@/lib/documents-types'
import type { ValidatedFilterSelections } from '@/lib/validated-filters'
import type {
  ValidatedRouteSearch,
  ValidatedSortBy,
  ValidatedSortDir,
} from '@/lib/validated-search-state'
import type { ValidatedTableRow } from '@/lib/validated-table-model'
import { filterValidatedRows } from '@/lib/validated-filters'
import {
  decodeCsv,
  hasActiveValidatedFilters,
  toggleCsvValue,
} from '@/lib/validated-search-state'
import { sortValidatedRows } from '@/lib/validated-sorters'
import {
  toValidatedTableRows,
  toValidatedTableRowsFromOperationalDocuments,
} from '@/lib/validated-table-model'
import { DocumentDetailDrawer } from '@/components/document-detail-drawer'
import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import { documentDetailsByFileName, validatedDocuments } from '@/data/mock-data'

const checkboxFacetConfigs = [
  { key: 'quarter', label: 'Quarter' },
  { key: 'customerType', label: 'Customer Type' },
  { key: 'errorType', label: 'Type of Errors' },
  { key: 'atc', label: 'ATC Codes' },
] as const

type CsvFacetKey = (typeof checkboxFacetConfigs)[number]['key']

const compareText = (left: string, right: string) =>
  left.localeCompare(right, undefined, { sensitivity: 'base' })

const quarterToNumber = (quarter: string) => {
  const match = quarter.match(/^Q([1-4])$/i)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number.parseInt(match[1], 10)
}

const dateTokenPattern = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/

const toDateToken = (value: Date) => format(value, 'yyyy-MM-dd')

const fromDateToken = (value: string): Date | undefined => {
  const match = value.trim().match(dateTokenPattern)
  if (!match) return undefined

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10) - 1
  const day = match[3] ? Number.parseInt(match[3], 10) : 1
  if (!Number.isFinite(year) || month < 0 || month > 11 || day < 1 || day > 31) {
    return undefined
  }

  return new Date(year, month, day)
}

const dateRangeLabel = (range: DateRange | undefined): string => {
  if (!range || (!range.from && !range.to)) return 'Select date range'
  if (range.from && range.to) {
    return `${format(range.from, 'MMM d, yyyy')} - ${format(range.to, 'MMM d, yyyy')}`
  }
  if (range.from) return `${format(range.from, 'MMM d, yyyy')} -`
  return `- ${format(range.to as Date, 'MMM d, yyyy')}`
}

const searchToDateRange = (
  search: Pick<ValidatedRouteSearch, 'year' | 'month'>,
): DateRange | undefined => {
  const from = fromDateToken(search.year)
  const to = fromDateToken(search.month)
  if (!from && !to) return undefined
  return { from, to }
}

function getValidatedTrailAndNextStep(status?: string) {
  const trail = [
    { label: 'Uploaded', status: 'complete' as const },
    { label: 'Queued', status: 'complete' as const },
    { label: 'OCR / Layout', status: 'complete' as const },
    { label: 'AI Normalize', status: 'complete' as const },
    { label: 'Validation + Variance', status: 'complete' as const },
    { label: 'Deduplication', status: 'complete' as const },
    { label: 'Rename + Persist', status: 'complete' as const },
    { label: 'Reconciliation', status: 'pending' as const },
  ]

  void status
  return { trail, nextStep: 'Export / reconciliation' }
}

function getFacetOptions(rows: Array<ValidatedTableRow>) {
  const quarter = Array.from(new Set(rows.map((row) => row.quarter))).sort(
    (left, right) => quarterToNumber(left) - quarterToNumber(right),
  )

  const customerType = Array.from(new Set(rows.map((row) => row.customerType))).sort(compareText)

  const errorType = Array.from(new Set(rows.flatMap((row) => row.errorTypes))).sort(compareText)

  const atc = Array.from(new Set(rows.map((row) => row.atc))).sort(compareText)

  return {
    quarter,
    customerType,
    errorType,
    atc,
  }
}

type ValidatedDocumentsFilterBarProps = {
  rows: Array<ValidatedTableRow>
  search: ValidatedRouteSearch
  onSearchChange: (patch: Partial<ValidatedRouteSearch>) => void
  actions?: ReactNode
  placement?: 'inline' | 'top-right'
  showChips?: boolean
}

export function ValidatedDocumentsFilterBar({
  rows,
  search,
  onSearchChange,
  actions,
  placement = 'inline',
  showChips = true,
}: ValidatedDocumentsFilterBarProps) {
  const isMobile = useIsMobile()
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)

  const filterSelections = useMemo<ValidatedFilterSelections>(
    () => ({
      q: search.q,
      year: search.year,
      month: search.month,
      quarter: decodeCsv(search.quarter),
      entity: search.entity,
      customerType: decodeCsv(search.customerType),
      customerName: search.customerName,
      errorType: decodeCsv(search.errorType),
      atc: decodeCsv(search.atc),
    }),
    [search],
  )

  const facetOptions = useMemo(() => getFacetOptions(rows), [rows])

  const updateSearch = (patch: Partial<ValidatedRouteSearch>) => onSearchChange(patch)

  const toggleFacet = (facet: CsvFacetKey, value: string) => {
    const nextCsv = toggleCsvValue(search[facet], value)
    updateSearch({ [facet]: nextCsv } as Partial<ValidatedRouteSearch>)
  }

  const clearFacet = (facet: CsvFacetKey) => {
    updateSearch({ [facet]: '' } as Partial<ValidatedRouteSearch>)
  }

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
      sortBy: 'amount',
      sortDir: 'desc',
    })
  }

  const selectedDateRange = useMemo<DateRange | undefined>(
    () => searchToDateRange(search),
    [search],
  )
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [draftDateRange, setDraftDateRange] = useState<DateRange | undefined>(
    selectedDateRange,
  )

  useEffect(() => {
    if (!datePickerOpen) {
      setDraftDateRange(selectedDateRange)
    }
  }, [datePickerOpen, selectedDateRange])

  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDraftDateRange(range)

    if (!range || (!range.from && !range.to)) {
      updateSearch({ year: '', month: '', q: '' })
      return
    }

    if (!range.from || !range.to) return

    const fromToken = toDateToken(range.from)
    const toToken = toDateToken(range.to)
    const queryToken = `${fromToken}..${toToken}`

    updateSearch({
      year: fromToken,
      month: toToken,
      q: queryToken,
    })
    setDatePickerOpen(false)
  }

  const appliedBadges = useMemo(() => {
    const badges: Array<{
      id: string
      label: string
      value: string
      onRemove: () => void
    }> = []

    if (search.year || search.month) {
      badges.push({
        id: 'date-range',
        label: 'Date range',
        value: `${search.year || 'Any'} to ${search.month || 'Any'}`,
        onRemove: () => updateSearch({ year: '', month: '', q: '' }),
      })
    }

    if (search.entity.length > 0) {
      badges.push({
        id: 'entity',
        label: 'Entity',
        value: search.entity,
        onRemove: () => updateSearch({ entity: '' }),
      })
    }

    if (search.customerName.length > 0) {
      badges.push({
        id: 'customer-name',
        label: 'Customer Name',
        value: search.customerName,
        onRemove: () => updateSearch({ customerName: '' }),
      })
    }

    for (const facet of checkboxFacetConfigs) {
      for (const value of decodeCsv(search[facet.key])) {
        badges.push({
          id: `${facet.key}-${value}`,
          label: facet.label,
          value,
          onRemove: () => toggleFacet(facet.key, value),
        })
      }
    }

    return badges
  }, [search, updateSearch])

  const panel = (
    <AdvancedFiltersPanel
      options={facetOptions}
      filters={filterSelections}
      onToggleFacet={toggleFacet}
      onClearFacet={clearFacet}
      onEntityChange={(value) => updateSearch({ entity: value })}
      onCustomerNameChange={(value) => updateSearch({ customerName: value })}
      onClearAll={clearAllFilters}
      hasAnyFilter={hasActiveValidatedFilters(search)}
    />
  )

  return (
    <div className="space-y-3">
      <div
        className={
          placement === 'top-right'
            ? 'flex w-full flex-wrap items-center justify-end gap-2'
            : 'flex w-full flex-wrap items-center gap-2'
        }
      >
        <Popover
          open={datePickerOpen}
          onOpenChange={(open) => {
            setDatePickerOpen(open)
            if (!open) setDraftDateRange(selectedDateRange)
          }}
        >
          <PopoverTrigger render={<Button variant="outline" size="sm" className="min-w-[16rem] justify-start text-left font-normal" />}>
            <IconCalendar className="size-4" />
            {dateRangeLabel(datePickerOpen ? draftDateRange : selectedDateRange)}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <Calendar
              initialFocus
              mode="range"
              numberOfMonths={isMobile ? 1 : 2}
              defaultMonth={draftDateRange?.from ?? selectedDateRange?.from}
              selected={draftDateRange}
              onSelect={handleDateRangeChange}
            />
          </PopoverContent>
        </Popover>

        {actions ? <div>{actions}</div> : null}

        {isMobile ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilterPanelOpen(true)}
            >
              <IconFilter className="size-4" />
              Filters
            </Button>
            <Sheet open={filterPanelOpen} onOpenChange={(open) => setFilterPanelOpen(open)}>
              <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Advanced Filters</SheetTitle>
                  <SheetDescription>
                    Reduce data by period, entity, customer, and error type.
                  </SheetDescription>
                </SheetHeader>
                <div className="px-6 pb-6">{panel}</div>
                <SheetFooter>
                  <SheetClose render={<Button variant="outline" />}>Close</SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </>
        ) : (
          <Popover>
            <PopoverTrigger render={<Button variant="outline" size="sm" />}>
              <IconFilter className="size-4" />
              Filters
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[30rem]">
              {panel}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {showChips && appliedBadges.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {appliedBadges.map((badge) => (
            <Badge
              key={badge.id}
              variant="outline"
              className="gap-1.5"
            >
              {badge.label}: {badge.value}
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={badge.onRemove}
                title={`Remove ${badge.value}`}
              >
                <IconX className="size-3" />
              </Button>
            </Badge>
          ))}

          <Button variant="ghost" size="sm" onClick={clearAllFilters}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  )
}

type ValidatedDocumentsPanelProps = {
  search: ValidatedRouteSearch
  onSearchChange: (patch: Partial<ValidatedRouteSearch>) => void
  rows?: Array<ValidatedTableRow>
  documents?: Array<OperationalDocumentView>
  actions?: ReactNode
  controlPlacement?: 'inline' | 'top-right'
  showControls?: boolean
  showChips?: boolean
}

export function ValidatedDocumentsPanel({
  search,
  onSearchChange,
  rows,
  documents,
  actions,
  controlPlacement = 'inline',
  showControls = true,
  showChips = true,
}: ValidatedDocumentsPanelProps) {
  const usesOperationalDocuments = documents !== undefined
  const [selectedId, setSelectedId] = useState(
    () => documents?.[0]?.id ?? validatedDocuments[0]?.id ?? '',
  )
  const [drawerOpen, setDrawerOpen] = useState(false)
  const tableRows = useMemo(
    () =>
      rows
        ? rows
        : usesOperationalDocuments
          ? toValidatedTableRowsFromOperationalDocuments(documents ?? [])
          : toValidatedTableRows(validatedDocuments),
    [documents, rows, usesOperationalDocuments],
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
      customerType: decodeCsv(search.customerType),
      customerName: search.customerName,
      errorType: decodeCsv(search.errorType),
      atc: decodeCsv(search.atc),
    }),
    [search],
  )

  const displayedRows = useMemo(() => {
    const filtered = filterValidatedRows(tableRows, filterSelections)
    return sortValidatedRows(filtered, {
      sortBy: search.sortBy,
      sortDir: search.sortDir,
    })
  }, [filterSelections, search.sortBy, search.sortDir, tableRows])

  const selectedOperationalDocument = usesOperationalDocuments
    ? documents?.find((doc) => doc.id === selectedId) ?? documents?.[0] ?? null
    : null
  const selectedMockDocument = usesOperationalDocuments
    ? null
    : validatedDocuments.find((doc) => doc.id === selectedId) ??
      validatedDocuments[0]
  const selectedDetails = selectedMockDocument
    ? documentDetailsByFileName[selectedMockDocument.fileName]
    : undefined
  const fallbackTrailAndNextStep = selectedMockDocument
    ? getValidatedTrailAndNextStep(selectedMockDocument.status)
    : null

  const isSortActive = (sortBy: ValidatedSortBy) =>
    search.sortBy === sortBy || (sortBy === 'customer' && search.sortBy === 'customerName')

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
      className={alignRight ? 'text-right' : undefined}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1 px-1"
        onClick={() => handleSortChange(sortBy)}
      >
        {label}
        {sortIndicator(sortBy)}
      </Button>
    </TableHead>
  )

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap gap-3 lg:flex-nowrap lg:items-start lg:justify-between">
          <div>
            <CardTitle>Validated documents</CardTitle>
            <CardDescription>Search, filter, and sort validated records.</CardDescription>
          </div>
          {showControls ? (
            <div
              className={
                controlPlacement === 'top-right'
                  ? 'flex w-full flex-col items-end gap-2 lg:w-auto lg:items-end'
                  : 'flex w-full flex-col gap-2 lg:items-start'
              }
            >
              <ValidatedDocumentsFilterBar
                rows={tableRows}
                search={search}
                onSearchChange={onSearchChange}
                actions={actions}
                placement={controlPlacement}
                showChips={showChips}
              />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document ID</TableHead>
              <TableHead>File</TableHead>
              {renderSortableHeader('customer', 'Customer')}
              {renderSortableHeader('year', 'Year')}
              {renderSortableHeader('month', 'Month')}
              {renderSortableHeader('quarter', 'Quarter')}
              {renderSortableHeader('entity', 'Entity')}
              {renderSortableHeader('customerType', 'Customer Type')}
              {renderSortableHeader('errorType', 'Type of Errors')}
              {renderSortableHeader('atc', 'ATC')}
              {renderSortableHeader('amount', 'Tax Withheld', true)}
              <TableHead>Confidence</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedRows.map((doc) => (
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
                className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                title="View validated document details"
              >
                <TableCell className="font-medium">{doc.docId}</TableCell>
                <TableCell>{doc.fileName}</TableCell>
                <TableCell>{doc.customerName}</TableCell>
                <TableCell>{doc.year}</TableCell>
                <TableCell>{doc.month}</TableCell>
                <TableCell>{doc.quarter}</TableCell>
                <TableCell>{doc.entity}</TableCell>
                <TableCell>{doc.customerType}</TableCell>
                <TableCell>{doc.errorTypes.join(', ') || 'None'}</TableCell>
                <TableCell>{doc.atc}</TableCell>
                <TableCell className="text-right">{doc.taxWithheld}</TableCell>
                <TableCell>{doc.confidence}</TableCell>
                <TableCell>
                  <StatusPill status={doc.status} />
                </TableCell>
              </TableRow>
            ))}
            {displayedRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={13}
                  className="h-20 text-center text-muted-foreground"
                >
                  No validated documents match the current filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
      {selectedOperationalDocument ? (
        <DocumentDetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={selectedOperationalDocument.fileName}
          subtitle={selectedOperationalDocument.id}
          status={selectedOperationalDocument.status}
          stage={selectedOperationalDocument.stage}
          nextStep={selectedOperationalDocument.nextStep}
          trail={selectedOperationalDocument.trail}
          confidence={selectedOperationalDocument.confidence}
          atc={selectedOperationalDocument.atc}
          payee={selectedOperationalDocument.payee}
          meta={[
            { label: 'Batch', value: selectedOperationalDocument.batchId },
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
      ) : selectedMockDocument && fallbackTrailAndNextStep ? (
        <DocumentDetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={selectedMockDocument.fileName}
          subtitle={selectedMockDocument.id}
          status={selectedMockDocument.status}
          stage="Validated"
          nextStep={fallbackTrailAndNextStep.nextStep}
          trail={fallbackTrailAndNextStep.trail}
          confidence={selectedMockDocument.confidence}
          atc={selectedMockDocument.atc}
          payee={selectedMockDocument.payee}
          meta={[
            { label: 'Period', value: selectedMockDocument.period },
            { label: 'Tax Base', value: selectedMockDocument.taxBase },
            { label: 'Tax Withheld', value: selectedMockDocument.taxWithheld },
          ]}
          processing={
            selectedDetails
              ? {
                  startedAt: selectedDetails.startedAt,
                  updatedAt: selectedDetails.updatedAt,
                  worker: selectedDetails.worker,
                  elapsed: selectedDetails.elapsed,
                }
              : undefined
          }
          logs={selectedDetails?.logs}
          errors={selectedDetails?.errors}
          openTo={`/documents/${selectedMockDocument.id}`}
        />
      ) : null}
    </Card>
  )
}

function AdvancedFiltersPanel({
  options,
  filters,
  onToggleFacet,
  onClearFacet,
  onEntityChange,
  onCustomerNameChange,
  onClearAll,
  hasAnyFilter,
}: {
  options: Record<CsvFacetKey, Array<string>>
  filters: ValidatedFilterSelections
  onToggleFacet: (facet: CsvFacetKey, value: string) => void
  onClearFacet: (facet: CsvFacetKey) => void
  onEntityChange: (value: string) => void
  onCustomerNameChange: (value: string) => void
  onClearAll: () => void
  hasAnyFilter: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Filter dimensions</p>
        <Button variant="ghost" size="sm" onClick={onClearAll} disabled={!hasAnyFilter}>
          Clear all filters
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Label htmlFor="entity-filter">Entity</Label>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onEntityChange('')}
              disabled={filters.entity.length === 0}
            >
              Clear
            </Button>
          </div>
          <Input
            id="entity-filter"
            placeholder="Type entity text"
            value={filters.entity}
            onChange={(event) => onEntityChange(event.target.value)}
          />
        </div>

        <div className="rounded-2xl border border-border/60 bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Label htmlFor="customer-filter">Customer Name</Label>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onCustomerNameChange('')}
              disabled={filters.customerName.length === 0}
            >
              Clear
            </Button>
          </div>
          <Input
            id="customer-filter"
            placeholder="Type customer name text"
            value={filters.customerName}
            onChange={(event) => onCustomerNameChange(event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {checkboxFacetConfigs.map((facet) => {
          const selected = filters[facet.key]
          const values = options[facet.key]

          return (
            <div
              key={facet.key}
              className="rounded-2xl border border-border/60 bg-muted/30 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <Label>{facet.label}</Label>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onClearFacet(facet.key)}
                  disabled={selected.length === 0}
                >
                  Clear
                </Button>
              </div>
              <div className="max-h-36 space-y-2 overflow-auto pr-1">
                {values.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No values available</p>
                ) : (
                  values.map((value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={selected.includes(value)}
                        onCheckedChange={() => onToggleFacet(facet.key, value)}
                        aria-label={`${facet.label}: ${value}`}
                      />
                      <span>{value}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
