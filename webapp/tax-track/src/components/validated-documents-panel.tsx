import {
  IconChevronDown,
  IconChevronUp,
  IconFilter,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import type { ValidatedFilterSelections } from '@/lib/validated-filters'
import type {
  ValidatedRouteSearch,
  ValidatedSortBy,
  ValidatedSortDir,
} from '@/lib/validated-search-state'
import { DocumentDetailDrawer } from '@/components/document-detail-drawer'
import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  Sheet,
  SheetClose,
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
import { useIsMobile } from '@/hooks/use-mobile'
import { documentDetailsByFileName, validatedDocuments } from '@/data/mock-data'
import { filterValidatedRows } from '@/lib/validated-filters'
import {
  decodeCsv,
  hasActiveValidatedFilters,
  toggleCsvValue,
} from '@/lib/validated-search-state'
import { sortValidatedRows } from '@/lib/validated-sorters'
import { getMonthSortIndex, toValidatedTableRows } from '@/lib/validated-table-model'

const facetConfigs = [
  { key: 'year', label: 'Year' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'entity', label: 'Entity' },
  { key: 'customerType', label: 'Customer Type' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'errorType', label: 'Type of Errors' },
  { key: 'atc', label: 'ATC Codes' },
] as const

type FacetKey = (typeof facetConfigs)[number]['key']

const compareText = (left: string, right: string) =>
  left.localeCompare(right, undefined, { sensitivity: 'base' })

const quarterToNumber = (quarter: string) => {
  const match = quarter.match(/^Q([1-4])$/i)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number.parseInt(match[1], 10)
}

function getValidatedTrailAndNextStep(status?: string) {
  const trail = [
    { label: 'Ingested (Drive)', status: 'complete' as const },
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

type ValidatedDocumentsPanelProps = {
  search: ValidatedRouteSearch
  onSearchChange: (patch: Partial<ValidatedRouteSearch>) => void
  actions?: ReactNode
  controlPlacement?: 'inline' | 'top-right'
}

export function ValidatedDocumentsPanel({
  search,
  onSearchChange,
  actions,
  controlPlacement = 'inline',
}: ValidatedDocumentsPanelProps) {
  const isMobile = useIsMobile()
  const [selectedId, setSelectedId] = useState(() => validatedDocuments[0].id)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)

  const tableRows = useMemo(() => toValidatedTableRows(validatedDocuments), [])

  const filterSelections = useMemo<ValidatedFilterSelections>(
    () => ({
      q: search.q,
      year: decodeCsv(search.year),
      month: decodeCsv(search.month),
      quarter: decodeCsv(search.quarter),
      entity: decodeCsv(search.entity),
      customerType: decodeCsv(search.customerType),
      customerName: decodeCsv(search.customerName),
      errorType: decodeCsv(search.errorType),
      atc: decodeCsv(search.atc),
    }),
    [search],
  )

  const facetOptions = useMemo(() => {
    const year = Array.from(new Set(tableRows.map((row) => row.year))).sort(
      (left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10),
    )

    const month = Array.from(new Set(tableRows.map((row) => row.month))).sort(
      (left, right) => getMonthSortIndex(left) - getMonthSortIndex(right),
    )

    const quarter = Array.from(new Set(tableRows.map((row) => row.quarter))).sort(
      (left, right) => quarterToNumber(left) - quarterToNumber(right),
    )

    const entity = Array.from(new Set(tableRows.map((row) => row.entity))).sort(
      compareText,
    )

    const customerType = Array.from(
      new Set(tableRows.map((row) => row.customerType)),
    ).sort(compareText)

    const customerName = Array.from(
      new Set(tableRows.map((row) => row.customerName)),
    ).sort(compareText)

    const errorType = Array.from(
      new Set(tableRows.flatMap((row) => row.errorTypes)),
    ).sort(compareText)

    const atc = Array.from(new Set(tableRows.map((row) => row.atc))).sort(
      compareText,
    )

    return {
      year,
      month,
      quarter,
      entity,
      customerType,
      customerName,
      errorType,
      atc,
    }
  }, [tableRows])

  const displayedRows = useMemo(() => {
    const filtered = filterValidatedRows(tableRows, filterSelections)
    return sortValidatedRows(filtered, {
      sortBy: search.sortBy,
      sortDir: search.sortDir,
    })
  }, [filterSelections, search.sortBy, search.sortDir, tableRows])

  const selectedDoc =
    validatedDocuments.find((doc) => doc.id === selectedId) ?? validatedDocuments[0]

  const selectedDetails = documentDetailsByFileName[selectedDoc.fileName]
  const { trail, nextStep } = getValidatedTrailAndNextStep(selectedDoc.status)

  const appliedFacetBadges = useMemo(
    () =>
      facetConfigs.flatMap((facet) =>
        decodeCsv(search[facet.key]).map((value) => ({
          key: facet.key,
          label: facet.label,
          value,
        })),
      ),
    [search],
  )

  const updateSearch = (patch: Partial<ValidatedRouteSearch>) => {
    onSearchChange(patch)
  }

  const toggleFacet = (facet: FacetKey, value: string) => {
    const nextCsv = toggleCsvValue(search[facet], value)
    updateSearch({ [facet]: nextCsv })
  }

  const clearFacet = (facet: FacetKey) => {
    updateSearch({ [facet]: '' })
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

  const panel = (
    <AdvancedFiltersPanel
      options={facetOptions}
      filters={filterSelections}
      onToggleFacet={toggleFacet}
      onClearFacet={clearFacet}
      onClearAll={clearAllFilters}
      hasAnyFilter={hasActiveValidatedFilters(search)}
    />
  )

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
      updateSearch({
        sortBy,
        sortDir: search.sortDir === 'asc' ? 'desc' : 'asc',
      })
      return
    }

    updateSearch({
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

  const toolbar = (
    <div
      className={
        controlPlacement === 'top-right'
          ? 'flex flex-wrap items-center justify-end gap-2'
          : 'flex flex-wrap items-center gap-2'
      }
    >
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          className="w-64 pl-9"
          placeholder="Search customer, file, ATC"
          value={search.q}
          onChange={(event) =>
            updateSearch({
              q: event.target.value,
            })
          }
        />
      </div>

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
          <Sheet
            open={filterPanelOpen}
            onOpenChange={(open) => setFilterPanelOpen(open)}
          >
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
  )

  return (
    <>
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap gap-3 lg:flex-nowrap lg:items-start lg:justify-between">
            <div>
              <CardTitle>Validated documents</CardTitle>
              <CardDescription>
                Search, filter, and sort validated records.
              </CardDescription>
            </div>
            <div
              className={
                controlPlacement === 'top-right'
                  ? 'flex w-full flex-col items-end gap-2 lg:w-auto lg:items-end'
                  : 'flex w-full flex-col gap-2 lg:items-start'
              }
            >
              {toolbar}
            </div>
          </div>

          {(appliedFacetBadges.length > 0 || search.q.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {search.q.length > 0 && (
                <Badge variant="outline" className="gap-1.5">
                  Search: {search.q}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => updateSearch({ q: '' })}
                    title="Remove search query"
                  >
                    <IconX className="size-3" />
                  </Button>
                </Badge>
              )}

              {appliedFacetBadges.map((badge) => (
                <Badge
                  key={`${badge.key}-${badge.value}`}
                  variant="outline"
                  className="gap-1.5"
                >
                  {badge.label}: {badge.value}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => toggleFacet(badge.key, badge.value)}
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
                    colSpan={12}
                    className="h-20 text-center text-muted-foreground"
                  >
                    No validated documents match the current filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DocumentDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={selectedDoc.fileName}
        subtitle={selectedDoc.id}
        status={selectedDoc.status}
        stage="Validated"
        nextStep={nextStep}
        trail={trail}
        confidence={selectedDoc.confidence}
        atc={selectedDoc.atc}
        payee={selectedDoc.payee}
        meta={[
          { label: 'Period', value: selectedDoc.period },
          { label: 'Tax Base', value: selectedDoc.taxBase },
          { label: 'Tax Withheld', value: selectedDoc.taxWithheld },
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
        openTo={`/documents/${selectedDoc.id}`}
      />
    </>
  )
}

function AdvancedFiltersPanel({
  options,
  filters,
  onToggleFacet,
  onClearFacet,
  onClearAll,
  hasAnyFilter,
}: {
  options: Record<FacetKey, Array<string>>
  filters: ValidatedFilterSelections
  onToggleFacet: (facet: FacetKey, value: string) => void
  onClearFacet: (facet: FacetKey) => void
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
        {facetConfigs.map((facet) => {
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
