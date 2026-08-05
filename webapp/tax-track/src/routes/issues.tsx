import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconEye,
  IconFileAlert,
  IconFileSpreadsheet,
  IconFileTypePdf,
  IconLoader2,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Icon } from '@tabler/icons-react'
import type { ReactNode } from 'react'

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
import { IssuesTour } from '@/components/product-tour'
import { RefreshStatus } from '@/components/refresh-status'
import { StatusPill } from '@/components/status-pill'
import {
  preserveScrollDuringNavigation,
  useDebouncedRouteSearchInput,
} from '@/hooks/use-preserved-route-search'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { downloadResponseAttachment } from '@/lib/download-client'
import {
  ISSUE_PAGE_SIZE_OPTIONS,
  buildIssueDocumentsExportQueryParams,
  buildIssueDocumentsQueryParams,
  hasActiveIssueFilters,
  parseIssueSearch,
} from '@/lib/issue-search-state'
import {
  ISSUES_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { cn } from '@/lib/utils'
import { formatPageLastUpdated } from '@/lib/active-polling'
import {
  getExtractionRetryDisabledMessage,
  isExtractionRetryActive,
  queueGeminiExtractionRetry,
} from '@/lib/extraction-retry-client'

export const Route = createFileRoute('/issues')({
  validateSearch: (search) => parseIssueSearch(search),
  component: RouteComponent,
})

const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'
const PANEL_BORDER_CLASS = 'border-border/60'
const ACTIVE_RETRY_POLL_INTERVAL_MS = 8_000

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
      return 'No errors match the current filters.'
    case 'duplicate':
      return 'No duplicates match the current filters.'
    default:
      return 'No errors or duplicates match the current filters.'
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
  const [isExporting, setIsExporting] = useState(false)
  const [isDownloadingFiles, setIsDownloadingFiles] = useState(false)
  const [downloadingIssueIds, setDownloadingIssueIds] = useState<Array<string>>(
    [],
  )
  const [retryingIssueIds, setRetryingIssueIds] = useState<Array<string>>([])
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const [tourStartSignal, setTourStartSignal] = useState(0)
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
  const exportQueryString = useMemo(
    () => buildIssueDocumentsExportQueryParams(issueSearch).toString(),
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
  const exportActionsDisabled = isLoading || pagination.totalItems === 0
  const isExportActionRunning = isExporting || isDownloadingFiles

  const updateSearch = useCallback(
    (
      patch: Partial<IssueRouteSearch>,
      options: { resetPage?: boolean } = { resetPage: true },
    ) => {
      void preserveScrollDuringNavigation(() =>
        navigate({
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
          resetScroll: false,
        }),
      )
    },
    [navigate],
  )

  const {
    inputValue: issueSearchInput,
    setInputValue: setIssueSearchInput,
    commitInputValue: commitIssueSearchInput,
  } = useDebouncedRouteSearchInput({
    value: issueSearch.q,
    onCommit: (value) => updateSearch({ q: value }),
  })

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
      setLastRefreshedAt(new Date())
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
  }, [refreshDocuments])

  const hasActiveExtractionRetry = documents.some((document) =>
    isExtractionRetryActive(document.extractionRetry),
  )

  useEffect(() => {
    if (!hasActiveExtractionRetry) return

    const refreshIfVisible = () => {
      if (globalThis.document.visibilityState === 'visible') {
        void refreshDocuments()
      }
    }
    const interval = window.setInterval(
      refreshIfVisible,
      ACTIVE_RETRY_POLL_INTERVAL_MS,
    )

    return () => window.clearInterval(interval)
  }, [hasActiveExtractionRetry, refreshDocuments])

  const handleExportCsv = useCallback(async () => {
    setIsExporting(true)

    try {
      const response = await fetch(
        exportQueryString
          ? `/api/documents/issues/export?${exportQueryString}`
          : '/api/documents/issues/export',
        { cache: 'no-store' },
      )

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null

        throw new Error(
          payload?.error ||
            `Failed to export issues queue CSV (${response.status}).`,
        )
      }

      const fileName = await downloadResponseAttachment(
        response,
        'Issues-Queue.csv',
      )

      toast.success('Export ready', {
        description: `${fileName} has been downloaded.`,
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to export issues queue CSV.',
      )
    } finally {
      setIsExporting(false)
    }
  }, [exportQueryString])

  const handleDownloadFiles = useCallback(async () => {
    setIsDownloadingFiles(true)

    try {
      const response = await fetch(
        exportQueryString
          ? `/api/documents/issues/files?${exportQueryString}`
          : '/api/documents/issues/files',
        { cache: 'no-store' },
      )

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null

        throw new Error(
          payload?.error ||
            `Failed to download issue files (${response.status}).`,
        )
      }

      const fileName = await downloadResponseAttachment(
        response,
        'Issue-Files.zip',
      )

      toast.success('Files ready', {
        description: `${fileName} has been downloaded.`,
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to download issue files.',
      )
    } finally {
      setIsDownloadingFiles(false)
    }
  }, [exportQueryString])

  const handleDownloadIssue = useCallback(
    async (issue: OperationalDocumentView) => {
      setDownloadingIssueIds((current) =>
        current.includes(issue.id) ? current : [...current, issue.id],
      )

      try {
        const response = await fetch(
          `/api/documents/${encodeURIComponent(issue.id)}/original-file`,
          { cache: 'no-store' },
        )

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string
          } | null

          throw new Error(
            payload?.error ||
              `Failed to download original file (${response.status}).`,
          )
        }

        const fileName = await downloadResponseAttachment(
          response,
          issue.fileName || 'original-file.pdf',
        )

        toast.success('File ready', {
          description: `${fileName} has been downloaded.`,
        })
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Unable to download original file.',
        )
      } finally {
        setDownloadingIssueIds((current) =>
          current.filter((issueId) => issueId !== issue.id),
        )
      }
    },
    [],
  )

  const handleRetryExtraction = useCallback(
    async (issue: OperationalDocumentView) => {
      setRetryingIssueIds((current) =>
        current.includes(issue.id) ? current : [...current, issue.id],
      )

      try {
        const retry = await queueGeminiExtractionRetry(issue)
        toast.success('Extraction retry queued', {
          description: `Retry ${retry.retryNumber} will reuse the original PDF.`,
        })
        await refreshDocuments()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Unable to queue the extraction retry.',
        )
      } finally {
        setRetryingIssueIds((current) =>
          current.filter((issueId) => issueId !== issue.id),
        )
      }
    },
    [refreshDocuments],
  )

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
      subtitle="Validation errors, processing failures, and duplicates"
      pageHelp={{
        label: 'Guide me through this page',
        onStartTour: () => setTourStartSignal((current) => current + 1),
      }}
      tourTargets={{
        title: ISSUES_TOUR_TARGETS.title,
      }}
    >
      <div className="flex flex-col gap-4">
        {loadError ? (
          <Alert variant="destructive" className="rounded-lg">
            <IconAlertTriangle />
            <AlertTitle>Unable to load issues queue</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        <div
          className="grid gap-2 md:grid-cols-3"
          {...getProductTourTargetProps(ISSUES_TOUR_TARGETS.summary)}
        >
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
            description="Validation and processing failures"
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
                  <CardTitle className="text-sm">Open issues</CardTitle>
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
              <div
                className="flex flex-wrap items-center gap-2"
                {...getProductTourTargetProps(ISSUES_TOUR_TARGETS.exportAction)}
              >
                <Badge variant="outline" className="gap-1">
                  <IconFileAlert className="size-3" />
                  {summary.errorCount} errors
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <IconCopy className="size-3" />
                  {summary.duplicateCount} duplicates
                </Badge>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          exportActionsDisabled || isExportActionRunning
                        }
                        className="min-w-28 justify-between"
                        aria-label="Export issue queue"
                      />
                    }
                  >
                    {isExportActionRunning ? (
                      <IconLoader2
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <IconDownload data-icon="inline-start" />
                    )}
                    {isExporting
                      ? 'Exporting'
                      : isDownloadingFiles
                        ? 'Downloading'
                        : 'Export'}
                    <IconChevronDown data-icon="inline-end" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={
                          exportActionsDisabled || isExportActionRunning
                        }
                        onClick={() => {
                          void handleExportCsv()
                        }}
                      >
                        {isExporting ? (
                          <IconLoader2 className="animate-spin" />
                        ) : (
                          <IconFileSpreadsheet />
                        )}
                        CSV report
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={
                          exportActionsDisabled || isExportActionRunning
                        }
                        onClick={() => {
                          void handleDownloadFiles()
                        }}
                      >
                        {isDownloadingFiles ? (
                          <IconLoader2 className="animate-spin" />
                        ) : (
                          <IconFileTypePdf />
                        )}
                        Original PDFs (.zip)
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <RefreshStatus
                  isRefreshing={isLoading}
                  lastUpdatedLabel={formatPageLastUpdated(lastRefreshedAt)}
                  refreshLabel="Refresh issues"
                  onRefresh={() => void refreshDocuments()}
                />
              </div>
            </div>
            <FieldGroup
              className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1.3fr)_minmax(9rem,0.75fr)_minmax(10rem,1fr)_minmax(8rem,0.65fr)_minmax(9rem,0.75fr)_minmax(8rem,0.65fr)]"
              {...getProductTourTargetProps(ISSUES_TOUR_TARGETS.filters)}
            >
              <Field>
                <FieldLabel htmlFor="issue-search" className="text-xs">
                  Search
                </FieldLabel>
                <div className="relative min-w-0">
                  <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="issue-search"
                    value={issueSearchInput}
                    className="pl-9"
                    placeholder="File, reason, owner"
                    onChange={(event) =>
                      setIssueSearchInput(event.currentTarget.value)
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
                    commitIssueSearchInput('', () =>
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
                      }),
                    )
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
                {...getProductTourTargetProps(ISSUES_TOUR_TARGETS.statusTabs)}
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
            <div {...getProductTourTargetProps(ISSUES_TOUR_TARGETS.table)}>
              <IssueTable
                rows={documents}
                emptyMessage={
                  isLoading
                    ? 'Loading issues...'
                    : getEmptyMessage(issueSearch.status)
                }
                downloadingIssueIds={downloadingIssueIds}
                retryingIssueIds={retryingIssueIds}
                onSelect={(issue) => {
                  setSelectedId(issue.id)
                  setDrawerOpen(true)
                }}
                onDownload={(issue) => {
                  void handleDownloadIssue(issue)
                }}
                onRetry={(issue) => {
                  void handleRetryExtraction(issue)
                }}
              />
            </div>
            <div
              className="flex flex-wrap items-center justify-between gap-3"
              {...getProductTourTargetProps(ISSUES_TOUR_TARGETS.pagination)}
            >
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
          reviewFields={selectedIssue.reviewFields}
          openTo={`/documents/${selectedIssue.id}`}
          extractionRetry={selectedIssue.extractionRetry}
          isRetryingExtraction={retryingIssueIds.includes(selectedIssue.id)}
          onRetryExtraction={() => {
            void handleRetryExtraction(selectedIssue)
          }}
        />
      ) : null}
      <IssuesTour startSignal={tourStartSignal} />
    </AppShell>
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

const getOriginalFileDownloadDisabledReason = (
  issue: OperationalDocumentView,
) =>
  issue.canDownloadOriginalFile === false ? 'Original file unavailable' : ''

export function IssueRowActions({
  issue,
  isDownloading,
  isRetrying,
  onDownload,
  onRetry,
}: {
  issue: OperationalDocumentView
  isDownloading: boolean
  isRetrying: boolean
  onDownload: (issue: OperationalDocumentView) => void
  onRetry: (issue: OperationalDocumentView) => void
}) {
  const downloadDisabledReason = getOriginalFileDownloadDisabledReason(issue)
  const isDownloadDisabled = isDownloading || Boolean(downloadDisabledReason)
  const downloadLabel = downloadDisabledReason || 'Download original PDF'
  const retry = issue.extractionRetry
  const retryDisabledReason = retry
    ? getExtractionRetryDisabledMessage(retry)
    : null
  const isRetryDisabled = isRetrying || !retry?.canRetry
  const retryLabel = isRetrying
    ? 'Queueing retry'
    : retry?.disabledReason === 'already_processing'
      ? 'Extraction queued'
      : 'Retry extraction'
  const retryTooltipLabel = retryDisabledReason || retryLabel

  return (
    <div className="flex items-center justify-end">
      <div className="hidden items-center justify-end gap-1.5 sm:flex">
        <ActionIconTooltip label="View document details">
          <Link
            to="/documents/$docId"
            params={{ docId: issue.id }}
            aria-label="View document details"
            className={buttonVariants({
              size: 'icon-xs',
              variant: 'outline',
            })}
          >
            <IconEye />
          </Link>
        </ActionIconTooltip>
        {retry ? (
          <ActionIconTooltip label={retryTooltipLabel}>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label={retryLabel}
              disabled={isRetryDisabled}
              title={retryDisabledReason || undefined}
              onClick={() => onRetry(issue)}
            >
              {isRetrying ? (
                <IconLoader2 className="animate-spin" />
              ) : (
                <IconRefresh />
              )}
            </Button>
          </ActionIconTooltip>
        ) : null}
        <ActionIconTooltip
          label={isDownloading ? 'Downloading original PDF' : downloadLabel}
        >
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label={downloadLabel}
            disabled={isDownloadDisabled}
            title={downloadDisabledReason || undefined}
            onClick={() => onDownload(issue)}
          >
            {isDownloading ? (
              <IconLoader2 className="animate-spin" />
            ) : (
              <IconDownload />
            )}
          </Button>
        </ActionIconTooltip>
      </div>

      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label={`More actions for ${issue.fileName}`}
              />
            }
          >
            <IconDotsVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem
                render={
                  <Link to="/documents/$docId" params={{ docId: issue.id }} />
                }
              >
                <IconEye />
                View
              </DropdownMenuItem>
              {retry ? (
                <DropdownMenuItem
                  disabled={isRetryDisabled}
                  title={retryDisabledReason || undefined}
                  onClick={() => onRetry(issue)}
                >
                  {isRetrying ? (
                    <IconLoader2 className="animate-spin" />
                  ) : (
                    <IconRefresh />
                  )}
                  {retryLabel}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={isDownloadDisabled}
                title={downloadDisabledReason || undefined}
                onClick={() => onDownload(issue)}
              >
                {isDownloading ? (
                  <IconLoader2 className="animate-spin" />
                ) : (
                  <IconDownload />
                )}
                {isDownloading ? 'Downloading...' : 'Download'}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function IssueTable({
  rows,
  emptyMessage,
  downloadingIssueIds,
  retryingIssueIds,
  onSelect,
  onDownload,
  onRetry,
}: {
  rows: Array<OperationalDocumentView>
  emptyMessage: string
  downloadingIssueIds: Array<string>
  retryingIssueIds: Array<string>
  onSelect: (issue: OperationalDocumentView) => void
  onDownload: (issue: OperationalDocumentView) => void
  onRetry: (issue: OperationalDocumentView) => void
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-background',
        PANEL_BORDER_CLASS,
      )}
    >
      <Table className="min-w-[840px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
        <TableHeader className="[&_tr]:border-border/60">
          <TableRow className="bg-muted/35 hover:bg-muted/35">
            <TableHead className="w-[18rem] bg-muted/35">File</TableHead>
            <TableHead className="bg-muted/35">Type</TableHead>
            <TableHead className="bg-muted/35">Reason</TableHead>
            <TableHead className="bg-muted/35">Severity</TableHead>
            <TableHead className="bg-muted/35">Owner</TableHead>
            <TableHead className="bg-muted/35 text-right">Updated</TableHead>
            <TableHead className="sticky right-0 w-[4rem] bg-muted/35 text-right sm:w-[5.5rem]">
              Actions
            </TableHead>
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
              className="group cursor-pointer border-border/60 bg-background hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
              <TableCell
                className="sticky right-0 bg-background text-right group-hover:bg-muted/35"
                onClick={(event) => event.stopPropagation()}
              >
                <IssueRowActions
                  issue={issue}
                  isDownloading={downloadingIssueIds.includes(issue.id)}
                  isRetrying={retryingIssueIds.includes(issue.id)}
                  onDownload={onDownload}
                  onRetry={onRetry}
                />
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
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
