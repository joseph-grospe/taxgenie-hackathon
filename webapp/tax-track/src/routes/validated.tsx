import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconFilter,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import { useMemo, useState } from 'react'

import type { ValidatedFilterSelections } from '@/lib/validated-filters'
import type {
  ValidatedRouteSearch,
  ValidatedSortBy,
} from '@/lib/validated-search-state'
import { AppShell } from '@/components/app-shell'
import { useIsMobile } from '@/hooks/use-mobile'
import { authClient } from '@/lib/auth-client'
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { documentDetailsByFileName, validatedDocuments } from '@/data/mock-data'
import { filterValidatedRows } from '@/lib/validated-filters'
import {
  decodeCsv,
  hasActiveValidatedFilters,
  parseValidatedSearch,
  toggleCsvValue,
} from '@/lib/validated-search-state'
import { sortValidatedRows } from '@/lib/validated-sorters'
import {
  getMonthSortIndex,
  toValidatedTableRows,
} from '@/lib/validated-table-model'

export const Route = createFileRoute('/validated')({
  validateSearch: (search) => parseValidatedSearch(search),
  component: RouteComponent,
})

const sortOptions: Array<{ value: ValidatedSortBy; label: string }> = [
  { value: 'amount', label: 'Amounts (Tax Withheld)' },
  { value: 'customer', label: 'Customers (A-Z)' },
  { value: 'year', label: 'Year' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'entity', label: 'Entity' },
  { value: 'customerType', label: 'Customer Type' },
  { value: 'customerName', label: 'Customer Name' },
  { value: 'errorType', label: 'Type of Errors' },
  { value: 'atc', label: 'ATC Codes' },
]

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

const compareText = (left: string, right: string) =>
  left.localeCompare(right, undefined, { sensitivity: 'base' })

const quarterToNumber = (quarter: string) => {
  const match = quarter.match(/^Q([1-4])$/i)
  if (!match) return Number.MAX_SAFE_INTEGER
  return Number.parseInt(match[1], 10)
}

function RouteComponent() {
  const navigate = useNavigate({ from: Route.fullPath })
  const isMobile = useIsMobile()
  const search = Route.useSearch()
  const { data: session } = authClient.useSession()
  const [selectedId, setSelectedId] = useState(() => validatedDocuments[0].id)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)

  const user = session?.user as
    | {
        role?: string | null
        canExportPdf?: boolean | null
        canExportExcel?: boolean | null
      }
    | undefined

  const canExportSelected = Boolean(
    user &&
    (user.role?.toLowerCase() === 'admin' ||
      user.canExportPdf ||
      user.canExportExcel),
  )

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

    const quarter = Array.from(
      new Set(tableRows.map((row) => row.quarter)),
    ).sort((left, right) => quarterToNumber(left) - quarterToNumber(right))

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
    validatedDocuments.find((doc) => doc.id === selectedId) ??
    validatedDocuments[0]

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
    void navigate({
      search: (previous) => parseValidatedSearch({ ...previous, ...patch }),
      replace: true,
    })
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

  return (
    <AppShell
      title="Validated Results"
      subtitle="Ready-to-export 2307 extractions"
      actions={
        <Button size="sm" disabled={!canExportSelected}>
          <IconDownload className="size-4" />
          Export selected
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Validated documents</CardTitle>
              <CardDescription>
                Search, filter, and sort validated records.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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

              <Select
                value={search.sortBy}
                onValueChange={(value: string | null) => {
                  if (!value) return
                  updateSearch({ sortBy: value as ValidatedSortBy })
                }}
              >
                <SelectTrigger size="sm" className="w-52">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent align="end">
                  {sortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  updateSearch({
                    sortDir: search.sortDir === 'asc' ? 'desc' : 'asc',
                  })
                }
                title="Toggle sort direction"
              >
                {search.sortDir === 'asc' ? (
                  <IconChevronUp className="size-4" />
                ) : (
                  <IconChevronDown className="size-4" />
                )}
                {search.sortDir === 'asc' ? 'Ascending' : 'Descending'}
              </Button>

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
                    <SheetContent
                      side="bottom"
                      className="max-h-[85vh] overflow-y-auto"
                    >
                      <SheetHeader>
                        <SheetTitle>Advanced Filters</SheetTitle>
                        <SheetDescription>
                          Reduce data by period, entity, customer, and error
                          type.
                        </SheetDescription>
                      </SheetHeader>
                      <div className="px-6 pb-6">{panel}</div>
                      <SheetFooter>
                        <SheetClose render={<Button variant="outline" />}>
                          Close
                        </SheetClose>
                      </SheetFooter>
                    </SheetContent>
                  </Sheet>
                </>
              ) : (
                <Popover>
                  <PopoverTrigger
                    render={<Button variant="outline" size="sm" />}
                  >
                    <IconFilter className="size-4" />
                    Filters
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[30rem]">
                    {panel}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>

          {(appliedFacetBadges.length > 0 || search.q.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 pt-3">
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
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document ID</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Payee</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>ATC</TableHead>
                <TableHead className="text-right">Tax Base</TableHead>
                <TableHead className="text-right">Tax Withheld</TableHead>
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
                  <TableCell>{doc.period}</TableCell>
                  <TableCell>{doc.atc}</TableCell>
                  <TableCell className="text-right">{doc.taxBase}</TableCell>
                  <TableCell className="text-right">
                    {doc.taxWithheld}
                  </TableCell>
                  <TableCell>{doc.confidence}</TableCell>
                  <TableCell>
                    <StatusPill status={doc.status} />
                  </TableCell>
                </TableRow>
              ))}
              {displayedRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
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
    </AppShell>
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          disabled={!hasAnyFilter}
        >
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
                  <p className="text-xs text-muted-foreground">
                    No values available
                  </p>
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
