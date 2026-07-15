import { Link, createFileRoute } from '@tanstack/react-router'
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconSearch,
  IconShieldExclamation,
  IconX,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { FormEvent, ReactNode } from 'react'

import { AppShell } from '@/components/app-shell'
import { OverridesTour } from '@/components/product-tour'
import { RefreshStatus } from '@/components/refresh-status'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  OVERRIDES_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { cn } from '@/lib/utils'
import { formatPageLastUpdated } from '@/lib/active-polling'
import { createManilaDateFormatter } from '@/lib/manila-time'

export const Route = createFileRoute('/override-requests')({
  component: OverrideRequestsPage,
})

const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'
const PANEL_BORDER_CLASS = 'border-border/60'
export const overrideDecisionSheetLayoutClasses = {
  content: 'data-[side=right]:w-full data-[side=right]:sm:max-w-xl',
  panel: 'flex min-h-0 flex-1 flex-col',
  body: 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4',
  footer: 'shrink-0 border-t p-4',
} as const

type OverrideStatus = 'pending' | 'approved' | 'rejected'
type OverrideStatusFilter = OverrideStatus | 'all'

type OverrideRequestView = {
  id: string
  documentResultId: number
  uploadId: string
  batchId: string
  status: OverrideStatus
  fileName: string
  entity: string
  payee: string
  payorName: string
  payorTin: string
  issueReason: string
  requestNote: string
  requestedAt: string
  requestedByName: string
  requestedByEmail: string | null
  decidedAt: string | null
  decidedByName: string | null
  decisionNote: string | null
}

type OverrideRequestsResponse = {
  requests?: Array<OverrideRequestView>
  summary?: Record<OverrideStatus, number>
  pagination?: OverridePagination
  error?: string
}

type OverridePagination = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

const DEFAULT_SUMMARY: Record<OverrideStatus, number> = {
  pending: 0,
  approved: 0,
  rejected: 0,
}

const DEFAULT_PAGINATION: OverridePagination = {
  page: 1,
  pageSize: 25,
  totalItems: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

const isPageSizeOption = (
  value: number,
): value is (typeof PAGE_SIZE_OPTIONS)[number] =>
  PAGE_SIZE_OPTIONS.some((option) => option === value)

const statusFilters: Array<{
  value: OverrideStatusFilter
  label: string
}> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
]

const statusBadgeClass: Record<OverrideStatus, string> = {
  pending: 'border-chart-4/30 bg-chart-4/10 text-chart-4',
  approved: 'border-primary/30 bg-primary/10 text-primary',
  rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
}

const statusIconClass: Record<OverrideStatus, string> = {
  pending: 'border-chart-4/25 bg-chart-4/10 text-chart-4',
  approved: 'border-primary/25 bg-primary/10 text-primary',
  rejected: 'border-destructive/25 bg-destructive/10 text-destructive',
}

const OVERRIDE_DATE_TIME_FORMATTER = createManilaDateFormatter('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function statusLabel(status: OverrideStatus) {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return 'Pending'
}

function formatOverrideDateTime(value: string | null | undefined) {
  if (!value) return '—'

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : OVERRIDE_DATE_TIME_FORMATTER.format(parsed)
}

function SummaryStat({
  label,
  value,
  detail,
  status,
}: {
  label: string
  value: number
  detail: string
  status: OverrideStatus
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-2">
      <div
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md border',
          statusIconClass[status],
        )}
      >
        <IconShieldExclamation className="size-3.5" />
      </div>
      <div className="min-w-0">
        <p className="flex items-baseline gap-2 text-sm font-semibold leading-tight">
          <span>{value.toLocaleString()}</span>
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>
        </p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

export function OverrideRequestsPage() {
  const [status, setStatus] = useState<OverrideStatusFilter>('pending')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGINATION.pageSize)
  const [requests, setRequests] = useState<Array<OverrideRequestView>>([])
  const [summary, setSummary] = useState(DEFAULT_SUMMARY)
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION)
  const [selectedId, setSelectedId] = useState('')
  const [decisionSheetOpen, setDecisionSheetOpen] = useState(false)
  const [decisionNote, setDecisionNote] = useState('')
  const [loadError, setLoadError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [decisionAction, setDecisionAction] = useState<
    'approve' | 'reject' | null
  >(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const [tourStartSignal, setTourStartSignal] = useState(0)
  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedId),
    [requests, selectedId],
  )

  const refreshRequests = useCallback(async () => {
    setIsLoading(true)

    try {
      const params = new URLSearchParams({
        status,
        page: String(page),
        pageSize: String(pageSize),
      })
      const trimmedQuery = query.trim()
      if (trimmedQuery) {
        params.set('q', trimmedQuery)
      }

      const response = await fetch(`/api/certificate-overrides?${params}`, {
        cache: 'no-store',
      })
      const payload = (await response
        .json()
        .catch(() => null)) as OverrideRequestsResponse | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load override requests (${response.status}).`,
        )
      }

      const nextRequests = Array.isArray(payload?.requests)
        ? payload.requests
        : []
      const nextPagination = {
        ...DEFAULT_PAGINATION,
        ...(payload?.pagination ?? {}),
      }
      setRequests(nextRequests)
      setSummary({ ...DEFAULT_SUMMARY, ...(payload?.summary ?? {}) })
      setPagination(nextPagination)
      setPage((current) =>
        current === nextPagination.page ? current : nextPagination.page,
      )
      setSelectedId((current) =>
        current && nextRequests.some((request) => request.id === current)
          ? current
          : '',
      )
      setLastRefreshedAt(new Date())
      setLoadError('')
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load override requests.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, query, status])

  useEffect(() => {
    void refreshRequests()
  }, [refreshRequests])

  useEffect(() => {
    if (decisionSheetOpen && !selectedRequest) {
      setDecisionSheetOpen(false)
      setSelectedId('')
    }
  }, [decisionSheetOpen, selectedRequest])

  const resultStart =
    pagination.totalItems === 0
      ? 0
      : (pagination.page - 1) * pagination.pageSize + 1
  const resultEnd =
    pagination.totalItems === 0
      ? 0
      : Math.min(pagination.totalItems, pagination.page * pagination.pageSize)

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setQuery(searchInput.trim())
    setPage(1)
  }

  const clearSearch = () => {
    setSearchInput('')
    setQuery('')
    setPage(1)
  }

  const selectRequest = (requestId: string) => {
    setSelectedId(requestId)
    setDecisionNote('')
    setDecisionSheetOpen(true)
  }

  const handleDecisionSheetOpenChange = (open: boolean) => {
    setDecisionSheetOpen(open)
    if (!open) {
      setSelectedId('')
      setDecisionNote('')
    }
  }

  const decideRequest = async (action: 'approve' | 'reject') => {
    if (!selectedRequest || selectedRequest.status !== 'pending') return

    const trimmedNote = decisionNote.trim()
    if (!trimmedNote) {
      toast.error('Decision note is required.')
      return
    }

    setDecisionAction(action)
    try {
      const response = await fetch(
        `/api/certificate-overrides/${encodeURIComponent(
          selectedRequest.id,
        )}/${action}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ decisionNote: trimmedNote }),
        },
      )
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to ${action} override request (${response.status}).`,
        )
      }

      toast.success(
        action === 'approve'
          ? 'Override request approved.'
          : 'Override request rejected.',
      )
      setDecisionNote('')
      setDecisionSheetOpen(false)
      setSelectedId('')
      await refreshRequests()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to update override request.'
      toast.error(message)
    } finally {
      setDecisionAction(null)
    }
  }

  return (
    <AppShell
      title="Overrides"
      subtitle="Review exception requests for failed BIR 2307 certificates."
      pageHelp={{
        label: 'Guide me through this page',
        onStartTour: () => setTourStartSignal((current) => current + 1),
      }}
      tourTargets={{
        title: OVERRIDES_TOUR_TARGETS.title,
      }}
    >
      <div className="grid gap-4">
        <div
          className={cn(
            'grid overflow-hidden rounded-lg border bg-background sm:grid-cols-3',
            PANEL_BORDER_CLASS,
            '[&>*:not(:last-child)]:border-b sm:[&>*:not(:last-child)]:border-b-0 sm:[&>*:not(:last-child)]:border-r',
          )}
          {...getProductTourTargetProps(OVERRIDES_TOUR_TARGETS.summary)}
        >
          <SummaryStat
            label="Pending"
            value={summary.pending}
            detail="Awaiting admin decision"
            status="pending"
          />
          <SummaryStat
            label="Approved"
            value={summary.approved}
            detail="Promoted to Validated Docs"
            status="approved"
          />
          <SummaryStat
            label="Rejected"
            value={summary.rejected}
            detail="Returned to Issues Queue"
            status="rejected"
          />
        </div>

        {loadError ? (
          <div className="rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {loadError}
          </div>
        ) : null}

        <Card size="sm" className={PANEL_CARD_CLASS}>
          <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-sm">Requests</CardTitle>
                <CardDescription className="mt-1 text-xs">
                  Review exception requests before they enter Validated Docs.
                </CardDescription>
              </div>
              <RefreshStatus
                isRefreshing={isLoading}
                lastUpdatedLabel={formatPageLastUpdated(lastRefreshedAt)}
                refreshLabel="Refresh override requests"
                onRefresh={() => void refreshRequests()}
              />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <form
                onSubmit={submitSearch}
                className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-end"
                {...getProductTourTargetProps(OVERRIDES_TOUR_TARGETS.search)}
              >
                <Field className="min-w-0 flex-1 gap-1.5">
                  <FieldLabel
                    htmlFor="override-request-search"
                    className="sr-only"
                  >
                    Search
                  </FieldLabel>
                  <div className="relative min-w-0">
                    <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="override-request-search"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      maxLength={160}
                      placeholder="Search file, entity, payor, TIN, requester"
                      className="pl-9"
                    />
                  </div>
                </Field>
                <div className="flex shrink-0 gap-2">
                  <Button type="submit" size="sm" disabled={isLoading}>
                    <IconSearch data-icon="inline-start" />
                    Search
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={clearSearch}
                    disabled={isLoading || (!query && !searchInput)}
                  >
                    <IconX data-icon="inline-start" />
                    Clear
                  </Button>
                </div>
              </form>

              <Tabs
                value={status}
                onValueChange={(value) => {
                  if (value) {
                    setStatus(value as OverrideStatusFilter)
                    setPage(1)
                  }
                }}
                className="shrink-0"
              >
                <TabsList
                  className={cn(
                    'w-full justify-start overflow-x-auto rounded-lg border p-1 sm:w-fit',
                    PANEL_BORDER_CLASS,
                  )}
                  {...getProductTourTargetProps(
                    OVERRIDES_TOUR_TARGETS.statusTabs,
                  )}
                >
                  {statusFilters.map((filter) => (
                    <TabsTrigger key={filter.value} value={filter.value}>
                      {filter.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <div className="grid gap-3">
              <div className="flex min-w-0 flex-col gap-3">
                <div
                  className={cn(
                    'overflow-x-auto rounded-lg border',
                    PANEL_BORDER_CLASS,
                  )}
                  {...getProductTourTargetProps(OVERRIDES_TOUR_TARGETS.table)}
                >
                  <Table className="min-w-[980px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
                    <TableHeader className="[&_tr]:border-border/60">
                      <TableRow className="bg-muted/35 hover:bg-muted/35">
                        <TableHead className="w-[20rem] bg-muted/35">
                          Request
                        </TableHead>
                        <TableHead className="bg-muted/35">Entity</TableHead>
                        <TableHead className="bg-muted/35">Issue</TableHead>
                        <TableHead className="bg-muted/35">
                          Requested by
                        </TableHead>
                        <TableHead className="bg-muted/35">Requested</TableHead>
                        <TableHead className="bg-muted/35">Status</TableHead>
                        <TableHead className="bg-muted/35 text-right">
                          Action
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="[&_tr:last-child]:border-b-0">
                      {requests.map((request) => {
                        const actionLabel =
                          request.status === 'pending' ? 'Review' : 'View'
                        const isSelected = selectedRequest?.id === request.id

                        return (
                          <TableRow
                            key={request.id}
                            tabIndex={0}
                            data-state={isSelected ? 'selected' : undefined}
                            aria-label={`Review override request for ${request.fileName}`}
                            aria-haspopup="dialog"
                            onClick={() => selectRequest(request.id)}
                            onKeyDown={(event) => {
                              if (
                                event.key === 'Enter' ||
                                event.key === ' '
                              ) {
                                event.preventDefault()
                                selectRequest(request.id)
                              }
                            }}
                            className="cursor-pointer border-l-2 border-l-transparent border-border/60 bg-background hover:bg-muted/35 data-[state=selected]:border-l-primary data-[state=selected]:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            <TableCell className="max-w-[20rem]">
                              <div className="min-w-0">
                                <p className="truncate font-medium">
                                  {request.fileName}
                                </p>
                                <p className="truncate text-muted-foreground">
                                  Payor: {request.payorName || '—'} · Payee:{' '}
                                  {request.payee || '—'}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[9rem] truncate">
                              {request.entity}
                            </TableCell>
                            <TableCell className="max-w-[14rem]">
                              <p className="line-clamp-2 leading-snug">
                                {request.issueReason || '—'}
                              </p>
                            </TableCell>
                            <TableCell className="max-w-[10rem]">
                              <p className="truncate">
                                {request.requestedByName}
                              </p>
                              {request.requestedByEmail ? (
                                <p className="truncate text-muted-foreground">
                                  {request.requestedByEmail}
                                </p>
                              ) : null}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {formatOverrideDateTime(request.requestedAt)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={statusBadgeClass[request.status]}
                              >
                                {statusLabel(request.status)}
                              </Badge>
                            </TableCell>
                            <TableCell
                              className="text-right"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Button
                                type="button"
                                size="xs"
                                variant={isSelected ? 'secondary' : 'outline'}
                                onClick={() => selectRequest(request.id)}
                                aria-label={`${actionLabel} override request for ${request.fileName}`}
                              >
                                {isSelected ? 'Selected' : actionLabel}
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                      {requests.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="h-24 text-center text-muted-foreground"
                          >
                            {isLoading
                              ? 'Loading override requests...'
                              : query
                                ? 'No override requests match the search.'
                                : 'No override requests found.'}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>

                <div
                  className="flex flex-col gap-3 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between"
                  {...getProductTourTargetProps(
                    OVERRIDES_TOUR_TARGETS.pagination,
                  )}
                >
                  <p className="text-xs text-muted-foreground">
                    Showing {resultStart.toLocaleString()}-
                    {resultEnd.toLocaleString()} of{' '}
                    {pagination.totalItems.toLocaleString()}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={String(pageSize)}
                      onValueChange={(value) => {
                        const nextPageSize = Number(value)
                        if (isPageSizeOption(nextPageSize)) {
                          setPageSize(nextPageSize)
                          setPage(1)
                        }
                      }}
                    >
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {PAGE_SIZE_OPTIONS.map((option) => (
                            <SelectItem key={option} value={String(option)}>
                              {option} rows
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">
                      Page {pagination.page.toLocaleString()} of{' '}
                      {pagination.totalPages.toLocaleString()}
                    </span>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      onClick={() =>
                        setPage((current) => Math.max(1, current - 1))
                      }
                      disabled={isLoading || !pagination.hasPreviousPage}
                      aria-label="Previous page"
                    >
                      <IconChevronLeft />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      onClick={() => setPage((current) => current + 1)}
                      disabled={isLoading || !pagination.hasNextPage}
                      aria-label="Next page"
                    >
                      <IconChevronRight />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Sheet open={decisionSheetOpen} onOpenChange={handleDecisionSheetOpenChange}>
          <SheetContent
            side="right"
            className={cn(
              overrideDecisionSheetLayoutClasses.content,
              PANEL_BORDER_CLASS,
            )}
          >
            <SheetHeader className={cn('border-b p-4', PANEL_BORDER_CLASS)}>
              <div className="flex min-w-0 items-start gap-3">
                <div
                  className={cn(
                    'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border',
                    statusIconClass[selectedRequest?.status ?? 'pending'],
                  )}
                >
                  <IconShieldExclamation className="size-4" />
                </div>
                <div className="min-w-0">
                  <SheetTitle className="text-sm">Decision</SheetTitle>
                  <SheetDescription className="mt-1 text-xs">
                    Review the selected request and record the decision note.
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <OverrideRequestDecisionPanel
              request={selectedRequest}
              decisionNote={decisionNote}
              onDecisionNoteChange={setDecisionNote}
              decisionAction={decisionAction}
              onApprove={() => void decideRequest('approve')}
              onReject={() => void decideRequest('reject')}
            />
          </SheetContent>
        </Sheet>
      </div>
      <OverridesTour startSignal={tourStartSignal} />
    </AppShell>
  )
}

export function OverrideRequestDecisionPanel({
  request,
  decisionNote,
  onDecisionNoteChange,
  decisionAction,
  onApprove,
  onReject,
}: {
  request: OverrideRequestView | undefined
  decisionNote: string
  onDecisionNoteChange: (value: string) => void
  decisionAction: 'approve' | 'reject' | null
  onApprove: () => void
  onReject: () => void
}) {
  const isPending = request?.status === 'pending'

  return (
    <div className={overrideDecisionSheetLayoutClasses.panel}>
      {!request ? (
        <div className={overrideDecisionSheetLayoutClasses.body}>
          <p className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
            Select a request to review.
          </p>
        </div>
      ) : (
        <>
          <div className={overrideDecisionSheetLayoutClasses.body}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge
                variant="outline"
                className={statusBadgeClass[request.status]}
              >
                {statusLabel(request.status)}
              </Badge>
              <Link
                to="/documents/$docId"
                params={{ docId: String(request.documentResultId) }}
                className={buttonVariants({ size: 'xs', variant: 'outline' })}
              >
                <IconExternalLink data-icon="inline-start" />
                Open document
              </Link>
            </div>

            <dl className="rounded-lg border border-border/70 bg-background">
              <DetailRow label="File">{request.fileName}</DetailRow>
              <DetailRow label="Entity">{request.entity}</DetailRow>
              <DetailRow label="Payee">{request.payee}</DetailRow>
              <DetailRow label="Payor">{request.payorName}</DetailRow>
              <DetailRow label="Payor TIN">{request.payorTin || '—'}</DetailRow>
              <DetailRow label="Issue">{request.issueReason}</DetailRow>
              <DetailRow label="Request note">{request.requestNote}</DetailRow>
              <DetailRow label="Requested by">
                {request.requestedByEmail
                  ? `${request.requestedByName} (${request.requestedByEmail})`
                  : request.requestedByName}
              </DetailRow>
              <DetailRow label="Requested at">
                <time
                  dateTime={request.requestedAt}
                  className="block whitespace-normal break-words leading-6"
                >
                  {formatOverrideDateTime(request.requestedAt)}
                </time>
              </DetailRow>
              {request.decisionNote ? (
                <DetailRow label="Decision note">
                  {request.decisionNote}
                </DetailRow>
              ) : null}
              {request.decidedByName ? (
                <DetailRow label="Decided by">
                  {request.decidedByName}
                </DetailRow>
              ) : null}
              {request.decidedAt ? (
                <DetailRow label="Decided at">
                  <time
                    dateTime={request.decidedAt}
                    className="block whitespace-normal break-words leading-6"
                  >
                    {formatOverrideDateTime(request.decidedAt)}
                  </time>
                </DetailRow>
              ) : null}
            </dl>

            {isPending ? (
              <Field>
                <FieldLabel htmlFor="override-decision-note">
                  Decision note
                </FieldLabel>
                <Textarea
                  id="override-decision-note"
                  value={decisionNote}
                  onChange={(event) => onDecisionNoteChange(event.target.value)}
                  maxLength={1200}
                  className="min-h-28 rounded-md bg-background"
                />
                <FieldDescription>
                  Required for both approval and rejection.
                </FieldDescription>
              </Field>
            ) : null}
          </div>

          {isPending ? (
            <SheetFooter
              className={cn(
                overrideDecisionSheetLayoutClasses.footer,
                PANEL_BORDER_CLASS,
              )}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={onApprove}
                  disabled={decisionAction !== null}
                >
                  <IconCheck data-icon="inline-start" />
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onReject}
                  disabled={decisionAction !== null}
                >
                  <IconX data-icon="inline-start" />
                  Reject
                </Button>
              </div>
            </SheetFooter>
          ) : null}
        </>
      )}
    </div>
  )
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1 border-b border-border/60 px-3 py-2 text-xs last:border-b-0">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  )
}
