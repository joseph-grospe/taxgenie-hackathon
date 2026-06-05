import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFileSpreadsheet,
  IconListDetails,
  IconSearch,
  IconShieldCheck,
  IconUserCheck,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Icon } from '@tabler/icons-react'
import type { AuditUserDisplay, AuditUserSummary } from '@/lib/audit-display'
import type { AuditTargetType } from '@/lib/audit-types'
import type {
  AuditActionFilter,
  AuditRouteSearch,
  AuditTargetTypeFilter,
} from '@/lib/audit-search-state'

import { AppShell } from '@/components/app-shell'
import { AuditTour } from '@/components/product-tour'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import {
  AUDIT_ACTION_OPTIONS,
  formatAuditAction,
  formatAuditTargetType,
  getAuditTargetDisplay,
  getAuditUserDisplay,
} from '@/lib/audit-display'
import {
  AUDIT_PAGE_SIZE_OPTIONS,
  buildAuditEventQueryParams,
  parseAuditSearch,
} from '@/lib/audit-search-state'
import {
  AUDIT_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/audit')({
  validateSearch: (search) => parseAuditSearch(search),
  component: RouteComponent,
})

const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'
const PANEL_BORDER_CLASS = 'border-border/60'
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Manila',
})

const DEFAULT_PAGINATION = {
  page: 1,
  pageSize: 25,
  totalItems: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

const DEFAULT_SUMMARY = {
  totalEvents: 0,
  uniqueActors: 0,
  systemEvents: 0,
}

type AuditLogEntry = {
  id: string
  occurredAt: string
  eventType: string
  actorUserId: string | null
  targetId: string | null
  targetType: AuditTargetType | null
  actor?: AuditUserSummary | null
  target?: AuditUserSummary | null
  metadata?: Record<string, unknown> | null
}

type AuditEventsResponse = {
  events?: Array<AuditLogEntry>
  pagination?: typeof DEFAULT_PAGINATION
  summary?: typeof DEFAULT_SUMMARY
  error?: string
}

type AuditExportFormat = 'csv' | 'xlsx'

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

function ResolvedUserText({
  display,
  muted = false,
}: {
  display: AuditUserDisplay
  muted?: boolean
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn('truncate font-medium', muted && 'text-muted-foreground')}
      >
        {display.label}
      </p>
      {display.detail ? (
        <p className="truncate text-[0.68rem] leading-4 text-muted-foreground">
          {display.detail}
        </p>
      ) : null}
    </div>
  )
}

function TargetText({ log }: { log: AuditLogEntry }) {
  const display = getAuditTargetDisplay({
    target: log.target,
    targetId: log.targetId,
    targetType: log.targetType,
  })

  return (
    <div className="flex min-w-0 items-start gap-2">
      {log.targetType ? (
        <Badge variant="secondary" className="shrink-0">
          {formatAuditTargetType(log.targetType)}
        </Badge>
      ) : null}
      <ResolvedUserText display={display} muted />
    </div>
  )
}

const formatDateTime = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return DATE_TIME_FORMATTER.format(parsed)
}

const formatMetadata = (
  metadata: Record<string, unknown> | null | undefined,
) => (metadata ? JSON.stringify(metadata) : '—')

const getActiveFilterCount = (search: AuditRouteSearch) =>
  [
    search.q,
    search.actor,
    search.action !== 'all' ? search.action : '',
    search.targetType !== 'all' ? search.targetType : '',
    search.dateFrom,
    search.dateTo,
  ].filter(Boolean).length

function RouteComponent() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const [auditEvents, setAuditEvents] = useState<Array<AuditLogEntry>>([])
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION)
  const [summary, setSummary] = useState(DEFAULT_SUMMARY)
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [exportFormat, setExportFormat] = useState<AuditExportFormat | null>(
    null,
  )
  const [tourStartSignal, setTourStartSignal] = useState(0)
  const activeFilterCount = useMemo(
    () => getActiveFilterCount(search),
    [search],
  )
  const queryString = useMemo(
    () => buildAuditEventQueryParams(search).toString(),
    [search],
  )
  const startRow =
    pagination.totalItems === 0 || auditEvents.length === 0
      ? 0
      : (pagination.page - 1) * pagination.pageSize + 1
  const endRow =
    pagination.totalItems === 0 || auditEvents.length === 0
      ? 0
      : Math.min(pagination.page * pagination.pageSize, pagination.totalItems)

  const updateSearch = useCallback(
    (
      patch: Partial<AuditRouteSearch>,
      options: { resetPage?: boolean } = { resetPage: true },
    ) => {
      void navigate({
        search: (previous) =>
          parseAuditSearch({
            ...previous,
            ...patch,
            page:
              options.resetPage === false ? (patch.page ?? previous.page) : 1,
          }),
        replace: true,
      })
    },
    [navigate],
  )

  const exportAuditEvents = useCallback(
    async (format: AuditExportFormat) => {
      setExportFormat(format)

      try {
        const params = new URLSearchParams(queryString)
        params.set('format', format)

        const response = await fetch(`/api/audit/export?${params.toString()}`, {
          cache: 'no-store',
        })

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string
          } | null

          throw new Error(
            payload?.error ||
              `Failed to export audit logs (${response.status}).`,
          )
        }

        const blob = await response.blob()
        const disposition = response.headers.get('content-disposition') ?? ''
        const fileNameMatch =
          disposition.match(/filename="([^"]+)"/i) ??
          disposition.match(/filename=([^;]+)/i)
        const fileName =
          fileNameMatch?.[1]?.trim() ??
          (format === 'csv' ? 'Audit-Trail.csv' : 'Audit-Trail.xlsx')

        const objectUrl = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = fileName
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(objectUrl)

        toast.success('Export ready', {
          description: `${fileName} has been downloaded.`,
        })
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Unable to export audit logs.',
        )
      } finally {
        setExportFormat(null)
      }
    },
    [queryString],
  )

  useEffect(() => {
    let cancelled = false

    const loadAuditEvents = async () => {
      setIsLoading(true)

      try {
        const response = await fetch(`/api/audit/events?${queryString}`, {
          cache: 'no-store',
        })
        const payload = (await response
          .json()
          .catch(() => ({}))) as AuditEventsResponse

        if (!response.ok) {
          throw new Error(
            typeof payload.error === 'string'
              ? payload.error
              : 'Unable to load audit events.',
          )
        }

        if (!Array.isArray(payload.events)) {
          throw new Error('Unexpected audit payload.')
        }

        if (cancelled) {
          return
        }

        setAuditEvents(payload.events)
        setPagination(payload.pagination ?? DEFAULT_PAGINATION)
        setSummary(payload.summary ?? DEFAULT_SUMMARY)
        setErrorMessage('')
      } catch (error) {
        if (cancelled) {
          return
        }

        setAuditEvents([])
        setPagination(DEFAULT_PAGINATION)
        setSummary(DEFAULT_SUMMARY)
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Unable to load audit events.',
        )
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadAuditEvents()

    return () => {
      cancelled = true
    }
  }, [queryString])

  return (
    <AppShell
      title="Audit Trail"
      subtitle="Immutable system and user activity log"
      pageHelp={{
        label: 'Guide me through this page',
        onStartTour: () => setTourStartSignal((current) => current + 1),
      }}
      tourTargets={{
        title: AUDIT_TOUR_TARGETS.title,
      }}
    >
      <div className="flex flex-col gap-4">
        {errorMessage ? (
          <Alert variant="destructive" className="rounded-lg">
            <IconAlertTriangle />
            <AlertTitle>Unable to load audit events</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div
          className="grid gap-2 md:grid-cols-3"
          {...getProductTourTargetProps(AUDIT_TOUR_TARGETS.summary)}
        >
          <SummaryTile
            icon={IconListDetails}
            label="Events"
            value={summary.totalEvents}
            description="Matching audit records"
          />
          <SummaryTile
            icon={IconUserCheck}
            label="Actors"
            value={summary.uniqueActors}
            description="Users and system"
          />
          <SummaryTile
            icon={IconShieldCheck}
            label="System"
            value={summary.systemEvents}
            description="Automated events"
          />
        </div>

        <Card size="sm" className={PANEL_CARD_CLASS}>
          <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-sm">Audit events</CardTitle>
                  <Badge variant="outline">
                    {pagination.totalItems.toLocaleString()} rows
                  </Badge>
                  {activeFilterCount > 0 ? (
                    <Badge variant="secondary">
                      {activeFilterCount} filters
                    </Badge>
                  ) : null}
                </div>
                <CardDescription className="mt-1 text-xs">
                  Track changes, exports, and exception handling.
                </CardDescription>
              </div>
              <div
                {...getProductTourTargetProps(AUDIT_TOUR_TARGETS.exportAction)}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={exportFormat !== null}
                      />
                    }
                  >
                    <IconDownload data-icon="inline-start" />
                    {exportFormat ? 'Exporting...' : 'Export'}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={exportFormat !== null}
                        onClick={() => void exportAuditEvents('csv')}
                      >
                        <IconDownload />
                        Export CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={exportFormat !== null}
                        onClick={() => void exportAuditEvents('xlsx')}
                      >
                        <IconFileSpreadsheet />
                        Export Excel
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <FieldGroup
              className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1.3fr)_minmax(11rem,1fr)_minmax(11rem,1fr)_minmax(9rem,0.75fr)_minmax(9rem,0.75fr)_auto]"
              {...getProductTourTargetProps(AUDIT_TOUR_TARGETS.filters)}
            >
              <Field>
                <FieldLabel htmlFor="audit-search" className="text-xs">
                  Search
                </FieldLabel>
                <div className="relative min-w-0">
                  <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="audit-search"
                    value={search.q}
                    className="pl-9"
                    placeholder="Action, user, target, metadata"
                    onChange={(event) =>
                      updateSearch({ q: event.currentTarget.value })
                    }
                  />
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="audit-action" className="text-xs">
                  Action
                </FieldLabel>
                <Select
                  value={search.action}
                  onValueChange={(value: AuditActionFilter | null) => {
                    if (value) updateSearch({ action: value })
                  }}
                >
                  <SelectTrigger id="audit-action" className="w-full">
                    <SelectValue placeholder="Action" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value="all">All actions</SelectItem>
                      {AUDIT_ACTION_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="audit-actor" className="text-xs">
                  Actor
                </FieldLabel>
                <Input
                  id="audit-actor"
                  value={search.actor}
                  placeholder="Name, email, ID"
                  onChange={(event) =>
                    updateSearch({ actor: event.currentTarget.value })
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="audit-target-type" className="text-xs">
                  Target
                </FieldLabel>
                <Select
                  value={search.targetType}
                  onValueChange={(value: AuditTargetTypeFilter | null) => {
                    if (value) updateSearch({ targetType: value })
                  }}
                >
                  <SelectTrigger id="audit-target-type" className="w-full">
                    <SelectValue placeholder="Target" />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectItem value="all">All targets</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="batch">Batch</SelectItem>
                      <SelectItem value="document">Document</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="audit-date-from" className="text-xs">
                  From
                </FieldLabel>
                <Input
                  id="audit-date-from"
                  type="date"
                  value={search.dateFrom}
                  onChange={(event) =>
                    updateSearch({ dateFrom: event.currentTarget.value })
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="audit-date-to" className="text-xs">
                  To
                </FieldLabel>
                <Input
                  id="audit-date-to"
                  type="date"
                  value={search.dateTo}
                  onChange={(event) =>
                    updateSearch({ dateTo: event.currentTarget.value })
                  }
                />
              </Field>
            </FieldGroup>

            {activeFilterCount > 0 ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateSearch({
                      q: '',
                      action: 'all',
                      actor: '',
                      targetType: 'all',
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
            <div
              className={cn(
                'overflow-hidden rounded-lg border bg-background',
                PANEL_BORDER_CLASS,
              )}
              {...getProductTourTargetProps(AUDIT_TOUR_TARGETS.table)}
            >
              <Table className="min-w-[900px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
                <TableHeader className="[&_tr]:border-border/60">
                  <TableRow className="bg-muted/35 hover:bg-muted/35">
                    <TableHead className="w-[12rem] bg-muted/35">
                      Timestamp
                    </TableHead>
                    <TableHead className="bg-muted/35">Actor</TableHead>
                    <TableHead className="bg-muted/35">Action</TableHead>
                    <TableHead className="bg-muted/35">Target</TableHead>
                    <TableHead className="bg-muted/35">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr:last-child]:border-b-0">
                  {auditEvents.length ? (
                    auditEvents.map((log) => {
                      const actor = getAuditUserDisplay(
                        log.actor,
                        log.actorUserId,
                        'System',
                      )

                      return (
                        <TableRow
                          key={log.id}
                          className="border-border/60 bg-background hover:bg-muted/35"
                        >
                          <TableCell className="text-muted-foreground">
                            {formatDateTime(log.occurredAt)}
                          </TableCell>
                          <TableCell className="max-w-[14rem]">
                            <ResolvedUserText display={actor} />
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" title={log.eventType}>
                              {formatAuditAction(log.eventType)}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[14rem]">
                            <TargetText log={log} />
                          </TableCell>
                          <TableCell className="max-w-[28rem] truncate text-muted-foreground">
                            {formatMetadata(log.metadata)}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        {errorMessage
                          ? 'No audit events available.'
                          : isLoading
                            ? 'Loading events...'
                            : 'No audit events match the current filters.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div
              className="flex flex-wrap items-center justify-between gap-3"
              {...getProductTourTargetProps(AUDIT_TOUR_TARGETS.pagination)}
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
                      {AUDIT_PAGE_SIZE_OPTIONS.map((pageSize) => (
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
      <AuditTour startSignal={tourStartSignal} />
    </AppShell>
  )
}
