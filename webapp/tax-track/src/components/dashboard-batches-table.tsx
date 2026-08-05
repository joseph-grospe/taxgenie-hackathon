import { useMemo, useState } from 'react'
import { IconSearch } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'

import type {
  DashboardBatchRow,
  DashboardRecentBatchesFilterOptions,
} from '@/lib/dashboard-types'
import { defaultBatchDetailSearch } from '@/lib/batch-file-search-state'
import { defaultBatchSearch } from '@/lib/batch-search-state'
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

const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'
const PAGE_SIZE = 5
const TABLE_SHELL_CLASS =
  'max-h-[310px] overflow-auto rounded-lg border border-border/70 bg-background'
const COMPACT_BADGE_CLASS = 'h-5 px-2 text-[11px]'
const CAUTION_BADGE_CLASS = 'border-chart-4/30 bg-chart-4/10 text-chart-4'
const DEFAULT_BATCH_DETAIL_ROUTE_SEARCH = {
  ...defaultBatchSearch,
  ...defaultBatchDetailSearch,
  status: 'all' as const,
  attention: 'all' as const,
}

const getBatchStatusVariant = (status: string) =>
  status === 'Error'
    ? 'outline'
    : status === 'Validated'
      ? 'secondary'
      : 'outline'

const getBatchStatusClassName = (status: string) =>
  cn(COMPACT_BADGE_CLASS, status === 'Error' && CAUTION_BADGE_CLASS)

export function DashboardBatchesTable({
  rows,
  filterOptions,
  loading = false,
}: {
  rows: Array<DashboardBatchRow>
  filterOptions: DashboardRecentBatchesFilterOptions
  loading?: boolean
}) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const statusOptions = filterOptions.statuses
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return rows.filter((row) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        row.id.toLowerCase().includes(normalizedQuery) ||
        row.name.toLowerCase().includes(normalizedQuery) ||
        row.owner.toLowerCase().includes(normalizedQuery)
      const matchesStatus =
        statusFilter === 'all' || row.status === statusFilter

      return matchesQuery && matchesStatus
    })
  }, [query, rows, statusFilter])
  const visibleRows = filteredRows.slice(0, PAGE_SIZE)

  return (
    <Card size="sm" className={`${PANEL_CARD_CLASS} h-full`}>
      <CardHeader className="gap-2 border-b border-border/60 bg-muted/10 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Recent Batches</CardTitle>
            <CardDescription className="text-xs leading-tight">
              Upload batches active in the selected dashboard period.
            </CardDescription>
          </div>
          <Badge variant="outline" className={COMPACT_BADGE_CLASS}>
            {filteredRows.length.toLocaleString()} batches
          </Badge>
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_160px]">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 bg-background pl-8 text-sm"
              placeholder="Search batch"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              if (value) setStatusFilter(value)
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All Status</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        <div className={TABLE_SHELL_CLASS}>
          <Table className="min-w-[680px] text-xs">
            <TableHeader className="sticky top-0 z-10 bg-muted/60">
              <TableRow>
                <TableHead className="h-9 min-w-[220px] px-2">Batch</TableHead>
                <TableHead className="hidden h-9 px-2 md:table-cell">
                  Status
                </TableHead>
                <TableHead className="h-9 px-2 text-right">Docs</TableHead>
                <TableHead className="hidden h-9 px-2 lg:table-cell">
                  Owner
                </TableHead>
                <TableHead className="h-9 px-2 text-right">Activity</TableHead>
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
                : visibleRows.map((row) => (
                    <TableRow key={row.id} className="hover:bg-muted/35">
                      <TableCell className="px-2 py-2">
                        <div className="min-w-0">
                          <Link
                            to="/batches/$batchId"
                            params={{ batchId: row.id }}
                            search={DEFAULT_BATCH_DETAIL_ROUTE_SEARCH}
                            className="block truncate font-medium text-foreground underline-offset-4 hover:underline"
                          >
                            {row.name}
                          </Link>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {row.id.slice(0, 8)} · {row.periodLabel}
                          </p>
                          <Badge
                            variant={getBatchStatusVariant(row.status)}
                            className={cn(
                              getBatchStatusClassName(row.status),
                              'mt-1 md:hidden',
                            )}
                          >
                            {row.status}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="hidden px-2 py-2 md:table-cell">
                        <Badge
                          variant={getBatchStatusVariant(row.status)}
                          className={getBatchStatusClassName(row.status)}
                        >
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right tabular-nums">
                        <p className="font-medium">
                          {row.uploaded.toLocaleString()}
                        </p>
                        <p className="text-[11px]">
                          <span className="text-chart-2">
                            {row.good.toLocaleString()} good
                          </span>
                          <span className="px-1 text-muted-foreground">·</span>
                          <span className="text-chart-4">
                            {row.bad.toLocaleString()} bad
                          </span>
                        </p>
                      </TableCell>
                      <TableCell className="hidden max-w-36 truncate px-2 py-2 text-muted-foreground lg:table-cell">
                        {row.owner}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-right text-muted-foreground">
                        {row.lastActivityAt}
                      </TableCell>
                    </TableRow>
                  ))}
              {!loading && visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No 2307 batches found for this period.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            Showing {visibleRows.length === 0 ? 0 : 1} to {visibleRows.length}{' '}
            of {filteredRows.length.toLocaleString()} batches
          </span>
          {query.trim().length > 0 || statusFilter !== 'all' ? (
            <Badge variant="outline" className={COMPACT_BADGE_CLASS}>
              Filtered
            </Badge>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
