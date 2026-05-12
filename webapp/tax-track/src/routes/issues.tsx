import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconFileAlert,
  IconSearch,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Icon } from '@tabler/icons-react'

import type { OperationalDocumentView } from '@/lib/documents-types'
import type {
  IssueDocumentFilterOptions,
  IssueDocumentPagination,
  IssueDocumentSummary,
} from '@/lib/documents-server'
import type {
  IssueRouteSearch,
  IssueStatusFilter,
} from '@/lib/issue-search-state'
import { AppShell } from '@/components/app-shell'
import { DocumentDetailDrawer } from '@/components/document-detail-drawer'
import { StatusPill } from '@/components/status-pill'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ISSUE_PAGE_SIZE_OPTIONS,
  buildIssueDocumentsQueryParams,
  hasActiveIssueFilters,
  parseIssueSearch,
} from '@/lib/issue-search-state'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/issues')({
  validateSearch: (search) => parseIssueSearch(search),
  component: RouteComponent,
})

const POLL_INTERVAL_MS = 8_000
const PANEL_CARD_CLASS = 'border border-border/70 shadow-sm'
const PANEL_BORDER_CLASS = 'border-border/70'

type DocumentsResponse = {
  documents?: Array<OperationalDocumentView>
  pagination?: IssueDocumentPagination
  summary?: IssueDocumentSummary
  filterOptions?: IssueDocumentFilterOptions
  error?: string
}

const DEFAULT_PAGINATION: IssueDocumentPagination = {
  page: 1,
  pageSize: 25,
  totalItems: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

const DEFAULT_SUMMARY: IssueDocumentSummary = {
  totalIssues: 0,
  errorCount: 0,
  duplicateCount: 0,
}

const DEFAULT_FILTER_OPTIONS: IssueDocumentFilterOptions = {
  severities: [],
  owners: [],
  years: [],
  months: [],
  quarters: [],
}

const getEmptyMessage = (status: IssueStatusFilter) => {
  switch (status) {
    case 'error':
      return 'No validation failures match the current filters.'
    case 'duplicate':
      return 'No duplicates match the current filters.'
    default:
      return 'No duplicates or validation failures match the current filters.'
  }
}

function SummaryTile({
  icon: IconComponent,
  label,
  value,
  description,
}: {
  icon: Icon
  label: string
  value: number
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

function RouteComponent() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const [documents, setDocuments] = useState<Array<OperationalDocumentView>>([])
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION)
  const [summary, setSummary] = useState(DEFAULT_SUMMARY)
  const [filterOptions, setFilterOptions] = useState(DEFAULT_FILTER_OPTIONS)
  const [selectedId, setSelectedId] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const issueSearch = useMemo(
    () => ({ ...search, dateFrom: '', dateTo: '' }),
    [search],
  )
  const activeFilterCount = useMemo(
    () =>
      [
        issueSearch.q,
        issueSearch.severity,
        issueSearch.owner,
        issueSearch.year,
        issueSearch.month,
        issueSearch.quarter,
      ].filter(Boolean).length,
    [issueSearch],
  )
  const queryString = useMemo(
    () => buildIssueDocumentsQueryParams(issueSearch).toString(),
    [issueSearch],
  )
  const startRow =
    pagination.totalItems === 0 || documents.length === 0
      ? 0
      : (pagination.page - 1) * pagination.pageSize + 1
  const endRow =
    pagination.totalItems === 0 || documents.length === 0
      ? 0
      : Math.min(pagination.page * pagination.pageSize, pagination.totalItems)

  const updateSearch = useCallback(
    (
      patch: Partial<IssueRouteSearch>,
      options: { resetPage?: boolean } = { resetPage: true },
    ) => {
      void navigate({
        search: (previous) =>
          parseIssueSearch({
            ...previous,
            ...patch,
            dateFrom: '',
            dateTo: '',
            page:
              options.resetPage === false ? (patch.page ?? previous.page) : 1,
          }),
        replace: true,
      })
    },
    [navigate],
  )

  useEffect(() => {
    if (!search.dateFrom && !search.dateTo) return

    void navigate({
      search: () => issueSearch,
      replace: true,
    })
  }, [issueSearch, navigate, search.dateFrom, search.dateTo])

  const refreshDocuments = useCallback(async () => {
    setIsLoading(true)

    try {
      const response = await fetch(`/api/documents/issues?${queryString}`, {
        cache: 'no-store',
      })

      const payload = (await response
        .json()
        .catch(() => null)) as DocumentsResponse | null

      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to load issues queue (${response.status}).`,
        )
      }

      setDocuments(Array.isArray(payload?.documents) ? payload.documents : [])
      setPagination(payload?.pagination ?? DEFAULT_PAGINATION)
      setSummary(payload?.summary ?? DEFAULT_SUMMARY)
      setFilterOptions(payload?.filterOptions ?? DEFAULT_FILTER_OPTIONS)
      setLoadError(null)
    } catch (error) {
      setDocuments([])
      setPagination(DEFAULT_PAGINATION)
      setSummary(DEFAULT_SUMMARY)
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load issues queue.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [queryString])

  useEffect(() => {
    void refreshDocuments()
    const interval = window.setInterval(() => {
      void refreshDocuments()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [refreshDocuments])

  useEffect(() => {
    if (documents.length === 0) {
      setSelectedId('')
      setDrawerOpen(false)
      return
    }

    if (!documents.some((document) => document.id === selectedId)) {
      setSelectedId(documents[0].id)
    }
  }, [documents, selectedId])

  const selectedIssue =
    documents.find((document) => document.id === selectedId) ??
    (documents.length > 0 ? documents[0] : undefined)

  return (
    <AppShell
      title="Issues Queue"
      subtitle="Duplicates and validation failures"
    >
      <div className="flex flex-col gap-4">
        {loadError ? (
          <Alert variant="destructive" className="rounded-lg">
            <IconAlertTriangle />
            <AlertTitle>Unable to load issues queue</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-2 md:grid-cols-3">
          <SummaryTile
            icon={IconFileAlert}
            label="Issues"
            value={summary.totalIssues}
            description="Total flagged records"
          />
          <SummaryTile
            icon={IconAlertTriangle}
            label="Errors"
            value={summary.errorCount}
            description="Validation failures"
          />
          <SummaryTile
            icon={IconCopy}
            label="Duplicates"
            value={summary.duplicateCount}
            description="Duplicate uploads"
          />
        </div>

        <Card size="sm" className={PANEL_CARD_CLASS}>
          <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-sm">Duplicates & errors</CardTitle>
                  <Badge variant="outline">
                    {pagination.totalItems.toLocaleString()} rows
                  </Badge>
                  {activeFilterCount > 0 ? (
                    <Badge variant="secondary">
                      {activeFilterCount} filters
                    </Badge>
                  ) : null}
                </div>
                <CardDescription className="text-xs">
                  Review upload outputs that were flagged by validation or
                  deduplication.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1">
                  <IconFileAlert className="size-3" />
                  {summary.errorCount} errors
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <IconCopy className="size-3" />
                  {summary.duplicateCount} duplicates
                </Badge>
              </div>
            </div>
            <FieldGroup className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1.3fr)_minmax(9rem,0.75fr)_minmax(10rem,1fr)_minmax(8rem,0.65fr)_minmax(9rem,0.75fr)_minmax(8rem,0.65fr)]">
              <Field>
                <FieldLabel htmlFor="issue-search" className="text-xs">
                  Search
                </FieldLabel>
                <div className="relative min-w-0">
                  <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="issue-search"
                    value={issueSearch.q}
                    className="pl-9"
                    placeholder="File, reason, owner"
                    onChange={(event) =>
                      updateSearch({ q: event.currentTarget.value })
                    }
                  />
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="issue-severity" className="text-xs">
                  Severity
                </FieldLabel>
                <Select
                  value={issueSearch.severity || 'all'}
                  onValueChange={(value: string | null) =>
                    updateSearch({
                      severity: value === 'all' ? '' : (value ?? ''),
                    })
                  }
                >
                  <SelectTrigger id="issue-severity" className="w-full">
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value="all">All severities</SelectItem>
                      {filterOptions.severities.map((severity) => (
                        <SelectItem key={severity} value={severity}>
                          {severity}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="issue-owner" className="text-xs">
                  Owner
                </FieldLabel>
                <Select
                  value={issueSearch.owner || 'all'}
                  onValueChange={(value: string | null) =>
                    updateSearch({
                      owner: value === 'all' ? '' : (value ?? ''),
                    })
                  }
                >
                  <SelectTrigger id="issue-owner" className="w-full">
                    <SelectValue placeholder="Owner" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value="all">All owners</SelectItem>
                      {filterOptions.owners.map((owner) => (
                        <SelectItem key={owner} value={owner}>
                          {owner}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="issue-year" className="text-xs">
                  Year
                </FieldLabel>
                <Select
                  value={issueSearch.year || 'all'}
                  onValueChange={(value: string | null) =>
                    updateSearch({
                      year: value === 'all' ? '' : (value ?? ''),
                    })
                  }
                >
                  <SelectTrigger id="issue-year" className="w-full">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value="all">All years</SelectItem>
                      {filterOptions.years.map((year) => (
                        <SelectItem key={year} value={year}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="issue-month" className="text-xs">
                  Month
                </FieldLabel>
                <Select
                  value={issueSearch.month || 'all'}
                  onValueChange={(value: string | null) =>
                    updateSearch({
                      month: value === 'all' ? '' : (value ?? ''),
                    })
                  }
                >
                  <SelectTrigger id="issue-month" className="w-full">
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value="all">All months</SelectItem>
                      {filterOptions.months.map((month) => (
                        <SelectItem key={month} value={month}>
                          {month}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="issue-quarter" className="text-xs">
                  Quarter
                </FieldLabel>
                <Select
                  value={issueSearch.quarter || 'all'}
                  onValueChange={(value: string | null) =>
                    updateSearch({
                      quarter: value === 'all' ? '' : (value ?? ''),
                    })
                  }
                >
                  <SelectTrigger id="issue-quarter" className="w-full">
                    <SelectValue placeholder="Quarter" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value="all">All quarters</SelectItem>
                      {filterOptions.quarters.map((quarter) => (
                        <SelectItem key={quarter} value={quarter}>
                          {quarter}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>

            {hasActiveIssueFilters(issueSearch) ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateSearch({
                      q: '',
                      severity: '',
                      owner: '',
                      entity: '',
                      year: '',
                      month: '',
                      quarter: '',
                      dateFrom: '',
                      dateTo: '',
                    })
                  }
                >
                  Clear filters
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Tabs
              value={issueSearch.status}
              onValueChange={(value) => {
                if (value) {
                  updateSearch({ status: value as IssueStatusFilter })
                }
              }}
              className="gap-3"
            >
              <TabsList
                className={cn(
                  'w-full justify-start overflow-x-auto rounded-lg border p-1 sm:w-fit',
                  PANEL_BORDER_CLASS,
                )}
              >
                <TabsTrigger value="all">
                  All ({summary.totalIssues.toLocaleString()})
                </TabsTrigger>
                <TabsTrigger value="error">
                  Errors ({summary.errorCount.toLocaleString()})
                </TabsTrigger>
                <TabsTrigger value="duplicate">
                  Duplicates ({summary.duplicateCount.toLocaleString()})
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <IssueTable
              rows={documents}
              emptyMessage={
                isLoading
                  ? 'Loading issues...'
                  : getEmptyMessage(issueSearch.status)
              }
              onSelect={(issue) => {
                setSelectedId(issue.id)
                setDrawerOpen(true)
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Showing {startRow}-{endRow} of{' '}
                {pagination.totalItems.toLocaleString()} rows
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={String(search.pageSize)}
                  onValueChange={(value: string | null) => {
                    if (value) {
                      updateSearch({
                        pageSize: Number.parseInt(value, 10),
                      })
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
                      {ISSUE_PAGE_SIZE_OPTIONS.map((pageSize) => (
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
                  disabled={!pagination.hasPreviousPage || isLoading}
                  onClick={() =>
                    updateSearch(
                      { page: Math.max(1, pagination.page - 1) },
                      { resetPage: false },
                    )
                  }
                >
                  <IconChevronLeft data-icon="inline-start" />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasNextPage || isLoading}
                  onClick={() =>
                    updateSearch(
                      { page: pagination.page + 1 },
                      { resetPage: false },
                    )
                  }
                >
                  Next
                  <IconChevronRight data-icon="inline-end" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedIssue ? (
        <DocumentDetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={selectedIssue.fileName}
          subtitle={selectedIssue.issueReason}
          status={selectedIssue.status}
          stage={selectedIssue.stage}
          nextStep={selectedIssue.nextStep}
          confidence={selectedIssue.confidence}
          atc={selectedIssue.atc}
          payee={selectedIssue.payee}
          meta={[
            { label: 'Reason', value: selectedIssue.issueReason },
            { label: 'Severity', value: selectedIssue.severity },
            { label: 'Owner', value: selectedIssue.owner },
            { label: 'Updated', value: selectedIssue.updatedAt },
          ]}
          processing={selectedIssue.processing}
          trail={selectedIssue.trail}
          logs={selectedIssue.logs}
          errors={selectedIssue.errors}
          openTo={`/documents/${selectedIssue.id}`}
        />
      ) : null}
    </AppShell>
  )
}

function IssueTable({
  rows,
  emptyMessage,
  onSelect,
}: {
  rows: Array<OperationalDocumentView>
  emptyMessage: string
  onSelect: (issue: OperationalDocumentView) => void
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-background',
        PANEL_BORDER_CLASS,
      )}
    >
      <Table className="min-w-[760px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
        <TableHeader className="[&_tr]:border-border/70">
          <TableRow className="bg-muted/35 hover:bg-muted/35">
            <TableHead className="w-[18rem] bg-muted/35">File</TableHead>
            <TableHead className="bg-muted/35">Type</TableHead>
            <TableHead className="bg-muted/35">Reason</TableHead>
            <TableHead className="bg-muted/35">Severity</TableHead>
            <TableHead className="bg-muted/35">Owner</TableHead>
            <TableHead className="bg-muted/35 text-right">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr:last-child]:border-b-0">
          {rows.map((issue) => (
            <TableRow
              key={issue.id}
              tabIndex={0}
              onClick={() => onSelect(issue)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(issue)
                }
              }}
              className="cursor-pointer border-border/70 bg-background hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              title="View issue detail"
            >
              <TableCell className="max-w-[18rem] truncate font-medium">
                {issue.fileName}
              </TableCell>
              <TableCell>
                <StatusPill status={issue.status} />
              </TableCell>
              <TableCell className="max-w-[22rem] truncate text-muted-foreground">
                {issue.issueReason}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="gap-1">
                  <IconAlertTriangle className="size-3" />
                  {issue.severity}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {issue.owner}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {issue.updatedAt}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}
