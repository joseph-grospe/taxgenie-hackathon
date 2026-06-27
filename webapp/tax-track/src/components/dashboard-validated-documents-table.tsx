'use client'

import { useMemo, useState } from 'react'
import { IconSearch } from '@tabler/icons-react'

import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import type { ValidatedTableRow } from '@/lib/validated-table-model'
import type { ValidatedFilterSelections } from '@/lib/validated-filters'
import { filterValidatedRows } from '@/lib/validated-filters'
import { useDebouncedRouteSearchInput } from '@/hooks/use-preserved-route-search'
import { decodeCsv } from '@/lib/validated-search-state'
import { sortValidatedRows } from '@/lib/validated-sorters'
import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 5
const TABLE_SHELL_CLASS =
  'max-h-[310px] overflow-auto rounded-lg border border-border/70 bg-background'
const COMPACT_BADGE_CLASS = 'h-5 px-2 text-[11px]'
const GOOD_BADGE_CLASS = 'border-chart-2/30 bg-chart-2/10 text-chart-2'

const toFilterSelections = (
  search: ValidatedRouteSearch,
): ValidatedFilterSelections => ({
  q: search.q,
  year: search.year,
  month: search.month,
  quarter: decodeCsv(search.quarter),
  entity: search.entity,
  customerType: decodeCsv(search.customerType),
  customerName: search.customerName,
  errorType: decodeCsv(search.errorType),
  atc: decodeCsv(search.atc),
})

export function DashboardValidatedDocumentsTable({
  rows,
  search,
  onSearchChange,
  loading = false,
}: {
  rows: Array<ValidatedTableRow>
  search: ValidatedRouteSearch
  onSearchChange: (patch: Partial<ValidatedRouteSearch>) => void
  loading?: boolean
}) {
  const [statusFilter, setStatusFilter] = useState('all')
  const {
    inputValue: customerSearchInput,
    setInputValue: setCustomerSearchInput,
  } = useDebouncedRouteSearchInput({
    value: search.customerName,
    onCommit: (value) => onSearchChange({ customerName: value }),
  })
  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.status))).sort(),
    [rows],
  )
  const atcOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.atc))).sort(),
    [rows],
  )
  const filteredRows = useMemo(() => {
    const filtered = filterValidatedRows(rows, toFilterSelections(search))
    const statusMatched =
      statusFilter === 'all'
        ? filtered
        : filtered.filter((row) => row.status === statusFilter)

    return sortValidatedRows(statusMatched, {
      sortBy: search.sortBy,
      sortDir: search.sortDir,
    })
  }, [rows, search, statusFilter])
  const visibleRows = filteredRows.slice(0, PAGE_SIZE)

  return (
    <Card
      size="sm"
      className="h-full rounded-lg border border-border/70 shadow-none ring-0"
    >
      <CardHeader className="gap-2 border-b border-border/60 bg-muted/10 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Validated Documents</CardTitle>
            <CardDescription className="text-xs leading-tight">
              Live certificates in the selected dashboard period.
            </CardDescription>
          </div>
          <Badge variant="outline" className={COMPACT_BADGE_CLASS}>
            {filteredRows.length.toLocaleString()} records
          </Badge>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(160px,1fr)_140px_120px]">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={customerSearchInput}
              onChange={(event) =>
                setCustomerSearchInput(event.target.value)
              }
              className="h-8 bg-background pl-8 text-sm"
              placeholder="Search customer"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              if (value) setStatusFilter(value)
            }}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="All Results" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All Results</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={search.atc || 'all'}
            onValueChange={(value) => {
              onSearchChange({ atc: value && value !== 'all' ? value : '' })
            }}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="All ATC" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All ATC</SelectItem>
                {atcOptions.map((atc) => (
                  <SelectItem key={atc} value={atc}>
                    {atc}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        <div className={TABLE_SHELL_CLASS}>
          <Table className="min-w-[720px] text-xs">
            <TableHeader className="sticky top-0 z-10 bg-muted/60">
              <TableRow>
                <TableHead className="h-9 min-w-[200px] px-2">File</TableHead>
                <TableHead className="h-9 min-w-[200px] px-2">
                  Customer
                </TableHead>
                <TableHead className="h-9 px-2">Details</TableHead>
                <TableHead className="h-9 px-2">Result</TableHead>
                <TableHead className="h-9 px-2 text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: PAGE_SIZE }, (_row, index) => (
                    <TableRow key={index}>
                      {Array.from({ length: 5 }, (_cell, cellIndex) => (
                        <TableCell key={cellIndex}>
                          <Skeleton className="h-3 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : visibleRows.map((row) => {
                    const isGood = row.errorTypes.includes('None')

                    return (
                      <TableRow key={row.docId} className="hover:bg-muted/35">
                        <TableCell className="px-2 py-2">
                          <div className="min-w-0">
                            <p className="max-w-48 truncate font-medium">
                              {row.fileName}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="px-2 py-2">
                          <p className="max-w-48 truncate font-medium">
                            {row.customerName}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {row.period}
                          </p>
                        </TableCell>
                        <TableCell className="px-2 py-2">
                          <div className="flex flex-wrap gap-1">
                            <Badge
                              variant="outline"
                              className={cn(
                                COMPACT_BADGE_CLASS,
                                'border-chart-1/30 bg-chart-1/10 text-chart-1',
                              )}
                            >
                              {row.atc}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={cn(
                                COMPACT_BADGE_CLASS,
                                'border-chart-5/30 bg-chart-5/10 text-chart-5',
                              )}
                            >
                              {row.quarter}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="px-2 py-2">
                          {isGood ? (
                            <Badge
                              variant="secondary"
                              className={cn(
                                COMPACT_BADGE_CLASS,
                                GOOD_BADGE_CLASS,
                              )}
                            >
                              Good
                            </Badge>
                          ) : (
                            <StatusPill
                              status={row.status}
                              className={COMPACT_BADGE_CLASS}
                            />
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            Confidence {row.confidence}
                          </p>
                        </TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">
                          <p className="font-medium">{row.taxWithheld}</p>
                          <p className="text-[11px] text-muted-foreground">
                            Base {row.taxBase}
                          </p>
                        </TableCell>
                      </TableRow>
                    )
                  })}
              {!loading && visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No validated documents found for this period.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            Showing {visibleRows.length === 0 ? 0 : 1} to {visibleRows.length}{' '}
            of {filteredRows.length.toLocaleString()} documents
          </span>
          {search.customerName.trim().length > 0 ||
          statusFilter !== 'all' ||
          search.atc ? (
            <Badge variant="outline" className={COMPACT_BADGE_CLASS}>
              Filtered
            </Badge>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
