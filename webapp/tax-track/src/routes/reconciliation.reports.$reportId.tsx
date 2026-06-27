import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconFileSpreadsheet,
  IconListCheck,
  IconLoader2,
  IconMail,
  IconRefresh,
  IconScale,
  IconSearch,
  IconSelectAll,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { FormEvent, ReactNode, RefObject } from 'react'

import type {
  BatchListPagination,
  BatchListResponse,
  BatchListRow,
} from '@/lib/upload-intake-types'
import type {
  SalesReportDetailView,
  SalesReportRunBatchView,
  SalesReportStatus,
  SalesReportVersionStatus,
} from '@/lib/sales-report-types'
import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import type { ReconciliationTableFilterValue } from '@/lib/reconciliation-table-state'
import type { SalesReportDetailRouteSearch } from '@/lib/sales-report-detail-search-state'
import { AppShell } from '@/components/app-shell'
import { SalesReportTour } from '@/components/product-tour'
import { ReconciliationDetailDrawer } from '@/components/reconciliation-detail-drawer'
import { ReconciliationResultsTable } from '@/components/reconciliation-results-table'
import {
  StatusPill,
  formatStatusLabel,
  statusToneStyles,
} from '@/components/status-pill'
import {
  preserveScrollDuringNavigation,
  useDebouncedRouteSearchInput,
} from '@/hooks/use-preserved-route-search'
import { authClient } from '@/lib/auth-client'
import {
  canExport,
  isAdmin,
  isEditor,
  parseSessionContext,
} from '@/lib/access-control'
import { defaultReconciliationSearch } from '@/lib/reconciliation-search-state'
import { downloadResponseAttachment } from '@/lib/download-client'
import {
  buildSalesReportDetailQueryParams,
  parseSalesReportDetailSearch,
} from '@/lib/sales-report-detail-search-state'
import {
  reconciliationPageSizeOptions,
  reconciliationTableFilterOptions,
} from '@/lib/reconciliation-table-state'
import {
  countPendingReconciliationCustomerEmailGroups,
  getReconciliationCustomerEmailGroupKey,
  isPendingReconciliationCustomerEmailRow,
} from '@/lib/reconciliation-customer-groups'
import {
  SALES_REPORT_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { createManilaDateFormatter } from '@/lib/manila-time'
import { xhrPut } from '@/lib/upload-intake-client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/reconciliation/reports/$reportId')({
  validateSearch: (search) => parseSalesReportDetailSearch(search),
  component: RouteComponent,
})

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const MAX_SELECTED_BATCHES = 100
const ELIGIBLE_BATCH_PAGE_SIZE = 25
const SELECT_ALL_ELIGIBLE_BATCH_PAGE_SIZE = MAX_SELECTED_BATCHES

const getOptionalTourTargetProps = (targetId?: string) =>
  targetId ? getProductTourTargetProps(targetId) : {}

const formatAmount = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : NUMBER_FORMATTER.format(value)

const DATE_TIME_FORMATTER = createManilaDateFormatter('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const formatDateTime = (value: string | null | undefined) =>
  value ? DATE_TIME_FORMATTER.format(new Date(value)) : '—'

const uniqueBatchIds = (batchIds: Array<string>) =>
  Array.from(new Set(batchIds))

export const buildEligibleBatchQueryParams = (input: {
  entityId: number
  page: number
  pageSize: number
  query: string
}) => {
  const params = new URLSearchParams({
    entityId: String(input.entityId),
    page: String(input.page),
    pageSize: String(input.pageSize),
    reconciliationEligible: 'true',
  })
  const normalizedQuery = input.query.trim()
  if (normalizedQuery) params.set('q', normalizedQuery)

  return params
}

export const resolveSelectAllBatchSelection = (input: {
  currentBatchIds: Array<string>
  fetchedBatchIds: Array<string>
  totalEligibleItems: number
  maxSelectedBatches?: number
}):
  | { status: 'selected' | 'unchanged'; selectedBatchIds: Array<string> }
  | {
      status: 'too_many'
      selectedBatchIds: Array<string>
      remaining: number
    } => {
  const maxSelectedBatches = input.maxSelectedBatches ?? MAX_SELECTED_BATCHES
  const currentBatchIds = uniqueBatchIds(input.currentBatchIds)
  const remaining = maxSelectedBatches - currentBatchIds.length

  if (remaining <= 0 || input.totalEligibleItems > remaining) {
    return {
      status: 'too_many',
      selectedBatchIds: currentBatchIds,
      remaining: Math.max(0, remaining),
    }
  }

  const selectedBatchIds = uniqueBatchIds([
    ...currentBatchIds,
    ...input.fetchedBatchIds,
  ])

  return {
    status:
      selectedBatchIds.length === currentBatchIds.length
        ? 'unchanged'
        : 'selected',
    selectedBatchIds,
  }
}

function PanelPagination({
  pagination,
  itemLabel,
  onPrevious,
  onNext,
  tourTarget,
}: {
  pagination: BatchListPagination | null | undefined
  itemLabel: string
  onPrevious: () => void
  onNext: () => void
  tourTarget?: string
}) {
  if (!pagination) return null

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
      {...getOptionalTourTargetProps(tourTarget)}
    >
      <span className="font-medium text-foreground">
        Page {pagination.page} of {pagination.totalPages}
        <span className="font-normal text-muted-foreground"> · </span>
        <span className="font-normal text-muted-foreground">
          {pagination.totalItems.toLocaleString()} {itemLabel}
        </span>
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!pagination.hasPreviousPage}
          onClick={onPrevious}
        >
          <IconChevronLeft data-icon="inline-start" />
          Previous
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={!pagination.hasNextPage}
          onClick={onNext}
        >
          Next
          <IconChevronRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  detail,
  icon,
}: {
  label: string
  value: ReactNode
  detail?: string
  icon?: ReactNode
}) {
  return (
    <div className="flex min-h-20 items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      {icon ? (
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground [&_svg]:size-4">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-1 truncate text-base font-medium text-foreground">
          {value}
        </div>
        {detail ? (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function ActionTooltip({
  disabledReason,
  children,
}: {
  disabledReason: string
  children: ReactNode
}) {
  if (!disabledReason) {
    return children
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex w-full sm:w-auto" />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent align="end" className="max-w-64">
        {disabledReason}
      </TooltipContent>
    </Tooltip>
  )
}

function LoadingReportCard() {
  return (
    <Card size="sm" className="border border-border/70">
      <CardHeader className="gap-3 border-b border-border/60">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </CardContent>
    </Card>
  )
}

function TableShell({
  children,
  tourTarget,
}: {
  children: ReactNode
  tourTarget?: string
}) {
  return (
    <div
      className="min-h-0 overflow-hidden rounded-lg border border-border/70 bg-background"
      {...getOptionalTourTargetProps(tourTarget)}
    >
      {children}
    </div>
  )
}

function TableScroll({ children }: { children: ReactNode }) {
  return <div className="max-h-[360px] overflow-auto">{children}</div>
}

function StickyTableHeader({ children }: { children: ReactNode }) {
  return (
    <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:h-8 [&_th]:bg-muted/35 [&_th]:text-[0.64rem] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-normal [&_th]:text-muted-foreground">
      {children}
    </TableHeader>
  )
}

function BatchPagination({
  pagination,
  onPrevious,
  onNext,
}: {
  pagination: BatchListPagination | null
  onPrevious: () => void
  onNext: () => void
}) {
  if (!pagination) return null

  return (
    <PanelPagination
      pagination={pagination}
      itemLabel="eligible batches"
      onPrevious={onPrevious}
      onNext={onNext}
    />
  )
}

function ResultsSummaryBadges({ report }: { report: SalesReportDetailView }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="outline" className={statusToneStyles.neutral}>
        {report.activeReconciliation.summary.totalRecords.toLocaleString()}{' '}
        total
      </Badge>
      <Badge variant="outline" className={statusToneStyles.success}>
        {report.activeReconciliation.summary.matched.toLocaleString()} matched
      </Badge>
      <Badge
        variant="outline"
        className={
          report.activeReconciliation.summary.unmatched > 0
            ? statusToneStyles.warning
            : statusToneStyles.success
        }
      >
        {report.activeReconciliation.summary.unmatched.toLocaleString()}{' '}
        unmatched
      </Badge>
    </div>
  )
}

function RowsSummaryBadge({ report }: { report: SalesReportDetailView }) {
  return (
    <Badge variant="outline" className={statusToneStyles.info}>
      {report.rowsPagination.totalItems.toLocaleString()} parsed rows
    </Badge>
  )
}

export const shouldShowSalesReportVersionStatus = (
  reportStatus: SalesReportStatus,
  versionStatus: SalesReportVersionStatus | null | undefined,
) =>
  Boolean(
    versionStatus &&
    formatStatusLabel(versionStatus) !== formatStatusLabel(reportStatus),
  )

function ReportIdentity({
  report,
  isSavingName,
  onOpenRename,
  tourTarget,
}: {
  report: SalesReportDetailView
  isSavingName: boolean
  onOpenRename: () => void
  tourTarget?: string
}) {
  const entityName =
    report.entity.shortName ??
    report.entity.companyName ??
    formatTinForDisplay(report.entity.tin)
  const versionStatus = report.currentVersion?.parseStatus
  const showVersionStatus = shouldShowSalesReportVersionStatus(
    report.status,
    versionStatus,
  )

  return (
    <div className="min-w-0" {...getOptionalTourTargetProps(tourTarget)}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={report.status} />
        {showVersionStatus && versionStatus ? (
          <StatusPill status={versionStatus} />
        ) : null}
        <Badge variant="outline" className={statusToneStyles.info}>
          v{report.currentVersion?.versionNumber ?? 0}
        </Badge>
        <Badge variant="outline" className={statusToneStyles.neutral}>
          {entityName}
        </Badge>
      </div>
      <div className="mt-3 flex min-w-0 items-start gap-2">
        <CardTitle className="min-w-0 break-words text-xl leading-tight">
          {report.name}
        </CardTitle>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="mt-0.5"
                disabled={isSavingName}
                aria-label="Rename report"
                onClick={onOpenRename}
              />
            }
          >
            <IconEdit />
          </TooltipTrigger>
          <TooltipContent>Rename report</TooltipContent>
        </Tooltip>
      </div>
      <CardDescription className="mt-2 truncate text-xs">
        {report.currentVersion?.originalFileName ?? 'No workbook uploaded'}
      </CardDescription>
    </div>
  )
}

function ReportActions({
  report,
  isLoading,
  isUploading,
  isExportingReconciliation,
  canExportReconciliationWorkbook,
  inputRef,
  onOpenRename,
  onRefresh,
  onExportReconciliation,
  onOpenDelete,
  tourTarget,
}: {
  report: SalesReportDetailView
  isLoading: boolean
  isUploading: boolean
  isExportingReconciliation: boolean
  canExportReconciliationWorkbook: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onOpenRename: () => void
  onRefresh: () => void
  onExportReconciliation: () => void
  onOpenDelete: () => void
  tourTarget?: string
}) {
  return (
    <div
      className="flex w-full flex-row flex-nowrap items-center gap-2 overflow-x-auto pb-1 xl:w-auto xl:justify-end xl:overflow-visible xl:pb-0"
      {...getOptionalTourTargetProps(tourTarget)}
    >
      <Button
        type="button"
        size="sm"
        variant="default"
        className="h-9 shrink-0 justify-start px-3"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
      >
        {isUploading ? (
          <IconLoader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <IconUpload data-icon="inline-start" />
        )}
        {isUploading ? 'Updating...' : 'Update file'}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Download report outputs"
              className="h-9 shrink-0 justify-start bg-background px-3"
            />
          }
        >
          <IconDownload data-icon="inline-start" />
          Download
          <IconChevronDown data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuItem
              render={
                <a href={`/api/sales-reports/${report.id}?download=original`} />
              }
            >
              <IconDownload />
              Original sales report
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                !canExportReconciliationWorkbook || isExportingReconciliation
              }
              title={
                !canExportReconciliationWorkbook
                  ? 'Excel export permission is required.'
                  : undefined
              }
              onClick={onExportReconciliation}
            >
              {isExportingReconciliation ? (
                <IconLoader2 className="animate-spin" />
              ) : (
                <IconFileSpreadsheet />
              )}
              {isExportingReconciliation
                ? 'Exporting workbook...'
                : 'Reconciliation workbook (.xlsx)'}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="size-9 shrink-0 bg-background"
              aria-label="More report actions"
              title="More report actions"
            />
          }
        >
          <IconDotsVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={isUploading} onClick={onOpenRename}>
              <IconEdit />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLoading} onClick={onRefresh}>
              {isLoading ? (
                <IconLoader2 className="animate-spin" />
              ) : (
                <IconRefresh />
              )}
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={onOpenDelete}>
              <IconTrash />
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function DetailStatGrid({
  report,
  tourTarget,
}: {
  report: SalesReportDetailView
  tourTarget?: string
}) {
  const version = report.currentVersion

  return (
    <div
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
      {...getOptionalTourTargetProps(tourTarget)}
    >
      <MetricTile
        label="Rows parsed"
        value={(version?.rowCount ?? 0).toLocaleString()}
        detail={version?.parseStatus ?? 'No version'}
        icon={<IconFileSpreadsheet />}
      />
      <MetricTile
        label="Matched"
        value={report.activeReconciliation.summary.matched.toLocaleString()}
        detail={`${report.activeReconciliation.summary.unmatched.toLocaleString()} unmatched`}
        icon={<IconCheck />}
      />
      <MetricTile
        label="Variance"
        value={formatAmount(report.activeReconciliation.summary.varianceTotal)}
        detail="Absolute tax base and withheld"
        icon={<IconScale />}
      />
      <MetricTile
        label="Updated"
        value={formatDateTime(report.updatedAt)}
        detail={version ? `v${version.versionNumber}` : undefined}
      />
    </div>
  )
}

function ReportNameEditor({
  open,
  nameInput,
  isSavingName,
  onOpenChange,
  onChange,
  onSave,
}: {
  open: boolean
  nameInput: string
  isSavingName: boolean
  onOpenChange: (open: boolean) => void
  onChange: (value: string) => void
  onSave: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Rename report</SheetTitle>
          <SheetDescription>
            Give this sales report a short name for easier lookup.
          </SheetDescription>
        </SheetHeader>
        <div className="px-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="sales-report-name">Report name</FieldLabel>
              <Input
                id="sales-report-name"
                value={nameInput}
                disabled={isSavingName}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    onSave()
                  }
                }}
              />
            </Field>
          </FieldGroup>
        </div>
        <SheetFooter>
          <SheetClose
            render={
              <Button type="button" variant="outline" disabled={isSavingName} />
            }
          >
            Cancel
          </SheetClose>
          <Button
            type="button"
            disabled={isSavingName || !nameInput.trim()}
            onClick={onSave}
          >
            {isSavingName ? (
              <IconLoader2 data-icon="inline-start" className="animate-spin" />
            ) : null}
            {isSavingName ? 'Saving...' : 'Save changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function ActiveRunBatchList({
  batches,
  removingBatchId,
  onRemove,
}: {
  batches: Array<SalesReportRunBatchView>
  removingBatchId: string | null
  onRemove: (batch: SalesReportRunBatchView) => void
}) {
  if (batches.length === 0) {
    return (
      <EmptyPanel>No batches currently attached to this report.</EmptyPanel>
    )
  }

  return (
    <div className="flex max-h-56 flex-col gap-2 overflow-auto pr-1">
      {batches.map((batch) => {
        const isRemoving = removingBatchId === batch.batchId

        return (
          <div
            key={batch.batchId}
            className="flex items-center gap-3 rounded-lg border border-border/70 bg-background px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {batch.name ?? batch.batchId}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {batch.totalFiles.toLocaleString()} files · closed{' '}
                {formatDateTime(batch.closedAt)}
              </p>
            </div>
            <Badge variant="outline" className="max-w-36 truncate">
              {batch.entityName}
            </Badge>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={Boolean(removingBatchId)}
                    aria-label={`Remove ${batch.name ?? batch.batchId}`}
                    onClick={() => onRemove(batch)}
                  />
                }
              >
                {isRemoving ? (
                  <IconLoader2 className="animate-spin" />
                ) : (
                  <IconTrash />
                )}
              </TooltipTrigger>
              <TooltipContent>Remove batch</TooltipContent>
            </Tooltip>
          </div>
        )
      })}
    </div>
  )
}

function RouteComponent() {
  const { reportId } = Route.useParams()
  const { data: session } = authClient.useSession()
  const context = session?.user ? parseSessionContext(session.user) : null
  const canExportReconciliationWorkbook = context
    ? canExport.excel(context.role, context.canExportExcel)
    : false
  const canSendReconciliationEmail = context
    ? isAdmin(context.role) || isEditor(context.role)
    : false
  const search = Route.useSearch()
  const {
    q: resultsQuery,
    filter: resultsFilter,
    page: resultsPage,
    pageSize: resultsPageSize,
    rowsQ: parsedRowsQuery,
    rowsPage,
    rowsPageSize,
  } = search
  const navigate = useNavigate({ from: Route.fullPath })
  const inputRef = useRef<HTMLInputElement | null>(null)
  const reportRequestIdRef = useRef(0)
  const [report, setReport] = useState<SalesReportDetailView | null>(null)
  const [eligibleBatches, setEligibleBatches] = useState<Array<BatchListRow>>(
    [],
  )
  const [eligibleBatchPagination, setEligibleBatchPagination] =
    useState<BatchListPagination | null>(null)
  const [batchSearchInput, setBatchSearchInput] = useState('')
  const [batchQuery, setBatchQuery] = useState('')
  const [batchPage, setBatchPage] = useState(1)
  const [selectedBatchIds, setSelectedBatchIds] = useState<Array<string>>([])
  const [tourStartSignal, setTourStartSignal] = useState(0)
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isSelectingAll, setIsSelectingAll] = useState(false)
  const [isExportingReconciliation, setIsExportingReconciliation] =
    useState(false)
  const [isSavingName, setIsSavingName] = useState(false)
  const [removingBatchId, setRemovingBatchId] = useState<string | null>(null)
  const [emailingCustomerGroupKey, setEmailingCustomerGroupKey] = useState<
    string | null
  >(null)
  const [selectedResultId, setSelectedResultId] = useState<number | null>(null)
  const [resultDrawerOpen, setResultDrawerOpen] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const latestRun = report?.runs.at(0) ?? null
  const activeRun = report?.activeRun ?? null
  const statusRun = activeRun ?? latestRun
  const selectedResultRow = useMemo(
    () =>
      report?.activeReconciliation.rows.find(
        (row) => row.id === selectedResultId,
      ) ?? null,
    [report, selectedResultId],
  )
  const selectedBatchIdSet = useMemo(
    () => new Set(selectedBatchIds),
    [selectedBatchIds],
  )
  const selectedBatchCountLabel = `${selectedBatchIds.length.toLocaleString()} / ${MAX_SELECTED_BATCHES.toLocaleString()} selected`
  const eligibleBatchTotal = eligibleBatchPagination?.totalItems ?? 0
  const isVisiblePageSelected =
    eligibleBatches.length > 0 &&
    eligibleBatches.every((batch) => selectedBatchIdSet.has(batch.id))
  const isAllVisibleFilteredBatchesSelected =
    eligibleBatchTotal > 0 &&
    eligibleBatchTotal <= eligibleBatches.length &&
    isVisiblePageSelected
  const selectPageLabel = isVisiblePageSelected
    ? 'Page selected'
    : 'Select page'
  const selectAllFilteredLabel = isSelectingAll
    ? 'Checking...'
    : isAllVisibleFilteredBatchesSelected
      ? 'All filtered selected'
      : 'Select all filtered'
  const visiblePendingEmailRows = useMemo(() => {
    const rows = report?.activeReconciliation.rows ?? []
    const seenGroupKeys = new Set<string>()
    const pendingRows: Array<ReconciliationRowView> = []

    for (const row of rows) {
      if (!isPendingReconciliationCustomerEmailRow(row)) continue

      const groupKey = getReconciliationCustomerEmailGroupKey(row)
      if (seenGroupKeys.has(groupKey)) continue

      seenGroupKeys.add(groupKey)
      pendingRows.push(row)
    }

    return pendingRows
  }, [report?.activeReconciliation.rows])
  const visiblePendingEmailGroupCount = useMemo(
    () =>
      countPendingReconciliationCustomerEmailGroups(
        report?.activeReconciliation.rows ?? [],
      ),
    [report?.activeReconciliation.rows],
  )
  const currentSearch = useMemo<SalesReportDetailRouteSearch>(
    () => ({
      q: resultsQuery,
      filter: resultsFilter,
      page: resultsPage,
      pageSize: resultsPageSize,
      rowsQ: parsedRowsQuery,
      rowsPage,
      rowsPageSize,
    }),
    [
      parsedRowsQuery,
      resultsFilter,
      resultsPage,
      resultsPageSize,
      resultsQuery,
      rowsPage,
      rowsPageSize,
    ],
  )
  const hasParsedRowSearch = Boolean(parsedRowsQuery)
  const hasResultFilters = Boolean(resultsQuery || resultsFilter !== 'all')
  const runDisabledReason =
    selectedBatchIds.length === 0
      ? 'Select at least one eligible closed batch.'
      : ''

  const openRenameSheet = useCallback(() => {
    if (!report) return

    setNameInput(report.name)
    setIsRenameOpen(true)
  }, [report])

  const updateResultSearch = useCallback(
    (
      patch: Partial<SalesReportDetailRouteSearch>,
      options: { resetPage?: boolean } = { resetPage: true },
    ) => {
      void preserveScrollDuringNavigation(() =>
        navigate({
          search: (previous) =>
            parseSalesReportDetailSearch({
              ...previous,
              ...patch,
              page:
                options.resetPage === false
                  ? (patch.page ?? previous.page)
                  : 1,
            }),
          replace: true,
          resetScroll: false,
        }),
      )
    },
    [navigate],
  )

  const updateParsedRowsSearch = useCallback(
    (
      patch: Partial<SalesReportDetailRouteSearch>,
      options: { resetPage?: boolean } = { resetPage: true },
    ) => {
      void preserveScrollDuringNavigation(() =>
        navigate({
          search: (previous) =>
            parseSalesReportDetailSearch({
              ...previous,
              ...patch,
              rowsPage:
                options.resetPage === false
                  ? (patch.rowsPage ?? previous.rowsPage)
                  : 1,
            }),
          replace: true,
          resetScroll: false,
        }),
      )
    },
    [navigate],
  )

  const {
    inputValue: parsedRowsSearchInput,
    setInputValue: setParsedRowsSearchInput,
    commitInputValue: commitParsedRowsSearchInput,
  } = useDebouncedRouteSearchInput({
    value: parsedRowsQuery,
    onCommit: (value) => updateParsedRowsSearch({ rowsQ: value }),
  })
  const {
    inputValue: resultsSearchInput,
    setInputValue: setResultsSearchInput,
    commitInputValue: commitResultsSearchInput,
  } = useDebouncedRouteSearchInput({
    value: resultsQuery,
    onCommit: (value) => updateResultSearch({ q: value }),
  })

  const refreshReport = useCallback(
    async (requestedSearch: SalesReportDetailRouteSearch = currentSearch) => {
      const requestId = reportRequestIdRef.current + 1
      reportRequestIdRef.current = requestId
      setIsLoading(true)
      try {
        const params = buildSalesReportDetailQueryParams(requestedSearch)
        const response = await fetch(
          `/api/sales-reports/${encodeURIComponent(reportId)}?${params.toString()}`,
          { cache: 'no-store' },
        )
        const payload = (await response.json().catch(() => null)) as {
          report?: SalesReportDetailView
          error?: string
        } | null

        if (!response.ok || !payload?.report) {
          throw new Error(
            payload?.error ||
              `Failed to load sales report (${response.status}).`,
          )
        }

        if (requestId !== reportRequestIdRef.current) return

        setReport(payload.report)
        setNameInput(payload.report.name)
        setLoadError(null)
      } catch (error) {
        if (requestId !== reportRequestIdRef.current) return
        setReport(null)
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to load sales report.',
        )
      } finally {
        if (requestId === reportRequestIdRef.current) {
          setIsLoading(false)
        }
      }
    },
    [currentSearch, reportId],
  )

  const refreshEligibleBatches = useCallback(
    async (entityId: number, page: number, query: string) => {
      const params = buildEligibleBatchQueryParams({
        entityId,
        page,
        pageSize: ELIGIBLE_BATCH_PAGE_SIZE,
        query,
      })

      const response = await fetch(
        `/api/uploads/batches?${params.toString()}`,
        {
          cache: 'no-store',
        },
      )
      const payload = (await response.json().catch(() => null)) as
        | (BatchListResponse & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to load batches (${response.status}).`,
        )
      }

      setEligibleBatches(payload?.batches ?? [])
      setEligibleBatchPagination(payload?.pagination ?? null)
    },
    [],
  )

  useEffect(() => {
    void refreshReport()
  }, [refreshReport])

  useEffect(() => {
    setBatchPage(1)
    setBatchQuery('')
    setBatchSearchInput('')
    setSelectedBatchIds([])
  }, [reportId])

  const submitBatchSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setBatchPage(1)
      setBatchQuery(batchSearchInput)
    },
    [batchSearchInput],
  )

  const clearBatchSearch = useCallback(() => {
    setBatchSearchInput('')
    setBatchQuery('')
    setBatchPage(1)
  }, [])

  const toggleBatchSelection = useCallback(
    (batchId: string, checked: boolean) => {
      setSelectedBatchIds((current) => {
        if (!checked) return current.filter((id) => id !== batchId)
        if (current.includes(batchId)) return current
        if (current.length >= MAX_SELECTED_BATCHES) {
          toast.error(`Select ${MAX_SELECTED_BATCHES} batches or fewer.`)
          return current
        }
        return [...current, batchId]
      })
    },
    [],
  )

  const selectVisibleBatches = useCallback(() => {
    setSelectedBatchIds((current) => {
      const next = [...current]

      for (const batch of eligibleBatches) {
        if (next.includes(batch.id)) continue
        if (next.length >= MAX_SELECTED_BATCHES) break

        next.push(batch.id)
      }

      if (next.length === current.length) return current
      return next
    })
  }, [eligibleBatches])

  const selectAllEligibleBatches = useCallback(async () => {
    if (!report) return

    if (selectedBatchIds.length >= MAX_SELECTED_BATCHES) {
      toast.error(`Select ${MAX_SELECTED_BATCHES} batches or fewer.`)
      return
    }

    setIsSelectingAll(true)
    try {
      const params = buildEligibleBatchQueryParams({
        entityId: report.entity.id,
        page: 1,
        pageSize: SELECT_ALL_ELIGIBLE_BATCH_PAGE_SIZE,
        query: batchQuery,
      })
      const response = await fetch(
        `/api/uploads/batches?${params.toString()}`,
        { cache: 'no-store' },
      )
      const payload = (await response.json().catch(() => null)) as
        | (BatchListResponse & { error?: string })
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to load batches (${response.status}).`,
        )
      }

      const result = resolveSelectAllBatchSelection({
        currentBatchIds: selectedBatchIds,
        fetchedBatchIds: (payload?.batches ?? []).map((batch) => batch.id),
        totalEligibleItems: payload?.pagination.totalItems ?? 0,
      })

      if (result.status === 'too_many') {
        toast.error('Too many eligible batches match this search.', {
          description:
            result.remaining > 0
              ? `Narrow the batch search to ${result.remaining.toLocaleString()} or fewer batches.`
              : `Clear selected batches or keep the selection at ${MAX_SELECTED_BATCHES} batches or fewer.`,
        })
        return
      }

      setSelectedBatchIds(result.selectedBatchIds)
      if (result.status === 'selected') {
        toast.success('Eligible batches selected.', {
          description: `${result.selectedBatchIds.length.toLocaleString()} batches selected.`,
        })
      } else {
        toast.info('All eligible batches are already selected.')
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to select eligible batches.',
      )
    } finally {
      setIsSelectingAll(false)
    }
  }, [batchQuery, report, selectedBatchIds])

  useEffect(() => {
    if (!report || !eligibleBatchPagination) return
    if (
      eligibleBatchPagination.totalPages > 0 &&
      batchPage > eligibleBatchPagination.totalPages
    ) {
      setBatchPage(eligibleBatchPagination.totalPages)
    }
  }, [batchPage, eligibleBatchPagination, report])

  useEffect(() => {
    if (!report) return
    const { rowsPagination } = report
    if (rowsPagination.totalPages > 0 && rowsPage > rowsPagination.totalPages) {
      updateParsedRowsSearch(
        { rowsPage: rowsPagination.totalPages },
        { resetPage: false },
      )
    }
  }, [report, rowsPage, updateParsedRowsSearch])

  useEffect(() => {
    if (!report?.activeReconciliation.pagination) return
    const { pagination } = report.activeReconciliation
    if (pagination.totalPages > 0 && resultsPage > pagination.totalPages) {
      updateResultSearch({ page: pagination.totalPages }, { resetPage: false })
    }
  }, [report, resultsPage, updateResultSearch])

  useEffect(() => {
    if (!report) return
    void refreshEligibleBatches(report.entity.id, batchPage, batchQuery).catch(
      (error) => {
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to load eligible batches.',
        )
      },
    )
  }, [batchPage, batchQuery, refreshEligibleBatches, report])

  const handleUpdateFile = useCallback(
    async (file: File | null) => {
      if (!file || !report) return
      setIsUploading(true)
      try {
        const presignResponse = await fetch('/api/sales-reports/presign', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            reportId: report.id,
            entityId: report.entity.id,
            name: report.name,
            file: {
              name: file.name,
              type:
                file.type ||
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              size: file.size,
            },
          }),
        })
        const presignPayload = (await presignResponse
          .json()
          .catch(() => null)) as {
          upload?: {
            reportId: string
            versionId: string
            url: string
            headers: Record<string, string>
          }
          error?: string
        } | null

        if (!presignResponse.ok || !presignPayload?.upload) {
          throw new Error(
            presignPayload?.error ||
              `Failed to prepare update (${presignResponse.status}).`,
          )
        }

        await xhrPut(
          presignPayload.upload.url,
          file,
          presignPayload.upload.headers,
          () => undefined,
        )

        const completeResponse = await fetch('/api/sales-reports/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            reportId: presignPayload.upload.reportId,
            versionId: presignPayload.upload.versionId,
          }),
        })
        const completePayload = (await completeResponse
          .json()
          .catch(() => null)) as { error?: string } | null

        if (!completeResponse.ok) {
          throw new Error(
            completePayload?.error ||
              `Failed to process update (${completeResponse.status}).`,
          )
        }

        const resetSearch = parseSalesReportDetailSearch({
          ...currentSearch,
          rowsPage: 1,
          page: 1,
        })
        void navigate({ search: resetSearch, replace: true })
        await refreshReport(resetSearch)
        toast.success('Sales report updated.')
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Unable to update sales report.',
        )
      } finally {
        setIsUploading(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [currentSearch, navigate, refreshReport, report],
  )

  const saveName = useCallback(async () => {
    if (!report || nameInput.trim() === report.name) return
    setIsSavingName(true)
    try {
      const response = await fetch(`/api/sales-reports/${report.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nameInput.trim() }),
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to rename sales report (${response.status}).`,
        )
      }

      await refreshReport()
      setIsRenameOpen(false)
      toast.success('Sales report renamed.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to rename sales report.',
      )
    } finally {
      setIsSavingName(false)
    }
  }, [nameInput, refreshReport, report])

  const deleteReport = useCallback(async () => {
    if (!report) return
    const response = await fetch(`/api/sales-reports/${report.id}`, {
      method: 'DELETE',
    })
    const payload = (await response.json().catch(() => null)) as {
      error?: string
    } | null

    if (!response.ok) {
      throw new Error(
        payload?.error || `Failed to delete sales report (${response.status}).`,
      )
    }

    toast.success('Sales report deleted.')
    void navigate({
      to: '/reconciliation',
      search: defaultReconciliationSearch,
    })
  }, [navigate, report])

  const runReconciliation = useCallback(async () => {
    if (!report || selectedBatchIds.length === 0) return
    setIsRunning(true)
    try {
      const response = await fetch(
        `/api/sales-reports/${report.id}/reconcile`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ batchIds: selectedBatchIds }),
        },
      )
      const payload = (await response.json().catch(() => null)) as {
        report?: SalesReportDetailView
        error?: string
      } | null

      if (!response.ok || !payload?.report) {
        throw new Error(
          payload?.error ||
            `Failed to run reconciliation (${response.status}).`,
        )
      }

      const resetSearch = parseSalesReportDetailSearch({
        ...currentSearch,
        page: 1,
      })
      void navigate({ search: resetSearch, replace: true })
      await refreshReport(resetSearch)
      setSelectedBatchIds([])
      await refreshEligibleBatches(report.entity.id, batchPage, batchQuery)
      toast.success('Reconciliation complete.', {
        description: `${payload.report.activeReconciliation.summary.matched.toLocaleString()} rows matched.`,
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to run reconciliation.',
      )
    } finally {
      setIsRunning(false)
    }
  }, [
    batchPage,
    batchQuery,
    currentSearch,
    navigate,
    refreshEligibleBatches,
    refreshReport,
    report,
    selectedBatchIds,
  ])

  const exportReconciliationWorkbook = useCallback(async () => {
    if (!report) return
    setIsExportingReconciliation(true)
    try {
      const response = await fetch(
        `/api/sales-reports/${encodeURIComponent(report.id)}?download=reconciliation`,
      )

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(
          payload?.error ||
            `Failed to export reconciliation workbook (${response.status}).`,
        )
      }

      const fileName = await downloadResponseAttachment(
        response,
        'Reconciliation-Report-All.xlsx',
      )
      toast.success('Export ready', {
        description: `${fileName} has been downloaded.`,
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to export reconciliation workbook.',
      )
    } finally {
      setIsExportingReconciliation(false)
    }
  }, [report])

  const removeBatchFromReport = useCallback(
    async (batch: SalesReportRunBatchView) => {
      if (!report) return

      setRemovingBatchId(batch.batchId)
      try {
        const response = await fetch(
          `/api/sales-reports/${encodeURIComponent(report.id)}/batches/${encodeURIComponent(batch.batchId)}`,
          { method: 'DELETE' },
        )
        const payload = (await response.json().catch(() => null)) as {
          report?: SalesReportDetailView
          error?: string
        } | null

        if (!response.ok || !payload?.report) {
          throw new Error(
            payload?.error || `Failed to remove batch (${response.status}).`,
          )
        }

        const resetSearch = parseSalesReportDetailSearch({
          ...currentSearch,
          page: 1,
        })
        void navigate({ search: resetSearch, replace: true })
        await refreshReport(resetSearch)
        setSelectedBatchIds((current) =>
          current.filter((batchId) => batchId !== batch.batchId),
        )
        await refreshEligibleBatches(report.entity.id, batchPage, batchQuery)
        toast.success('Batch removed from sales report.', {
          description: payload.report.activeRun
            ? `${payload.report.activeRun.selectedBatchCount.toLocaleString()} batches remain in this report.`
            : 'Active reconciliation results were cleared.',
        })
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Unable to remove batch from sales report.',
        )
      } finally {
        setRemovingBatchId(null)
      }
    },
    [
      batchPage,
      batchQuery,
      currentSearch,
      navigate,
      refreshEligibleBatches,
      refreshReport,
      report,
    ],
  )

  const sendReconciliationEmailForRow = useCallback(
    async (row: ReconciliationRowView) => {
      const response = await fetch(`/api/reconciliation/${row.id}`, {
        method: 'POST',
      })
      const payload = (await response.json().catch(() => null)) as {
        message?: string
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to send reconciliation email (${response.status}).`,
        )
      }

      return payload?.message || `Email sent for ${row.customerName}.`
    },
    [],
  )

  const handleSendEmail = useCallback(
    async (row: ReconciliationRowView) => {
      setEmailingCustomerGroupKey(getReconciliationCustomerEmailGroupKey(row))
      try {
        const message = await sendReconciliationEmailForRow(row)

        await refreshReport()
        toast.success('Email sent successfully', {
          description: message,
        })
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to send reconciliation email.'

        toast.error('Unable to send reconciliation email.', {
          description: message,
        })
      } finally {
        setEmailingCustomerGroupKey(null)
      }
    },
    [refreshReport, sendReconciliationEmailForRow],
  )

  const handleEmailVisiblePending = useCallback(async () => {
    if (visiblePendingEmailRows.length === 0) return

    let sentCount = 0

    try {
      for (const row of visiblePendingEmailRows) {
        setEmailingCustomerGroupKey(getReconciliationCustomerEmailGroupKey(row))
        await sendReconciliationEmailForRow(row)
        sentCount += 1
      }

      await refreshReport()
      toast.success('Pending emails sent.', {
        description: `${sentCount.toLocaleString()} customer ${
          sentCount === 1 ? 'group' : 'groups'
        } emailed from this page.`,
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to send pending reconciliation emails.'

      toast.error('Unable to send pending emails.', {
        description: message,
      })
    } finally {
      setEmailingCustomerGroupKey(null)
    }
  }, [refreshReport, sendReconciliationEmailForRow, visiblePendingEmailRows])

  return (
    <AppShell
      title="Sales Report"
      subtitle="Review parsed rows, select batches, and run reconciliation"
      leadingActions={
        <Button
          type="button"
          size="sm"
          variant="outline"
          render={
            <Link to="/reconciliation" search={defaultReconciliationSearch} />
          }
        >
          <IconArrowLeft data-icon="inline-start" />
          Back
        </Button>
      }
      pageHelp={
        report
          ? {
              label: 'Guide me through this sales report',
              onStartTour: () => setTourStartSignal((current) => current + 1),
            }
          : undefined
      }
      tourTargets={{
        leadingActions: SALES_REPORT_TOUR_TARGETS.backAction,
        title: SALES_REPORT_TOUR_TARGETS.title,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(event) => {
          void handleUpdateFile(event.target.files?.item(0) ?? null)
        }}
      />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        {loadError ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertTitle>Unable to load sales report</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        {!report && isLoading ? <LoadingReportCard /> : null}

        {report ? (
          <>
            <Card size="sm" className="border border-border/70">
              <CardHeader className="gap-4 border-b border-border/60">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <ReportIdentity
                    report={report}
                    isSavingName={isSavingName}
                    onOpenRename={openRenameSheet}
                    tourTarget={SALES_REPORT_TOUR_TARGETS.identity}
                  />
                  <ReportActions
                    report={report}
                    isLoading={isLoading}
                    isUploading={isUploading}
                    isExportingReconciliation={isExportingReconciliation}
                    canExportReconciliationWorkbook={
                      canExportReconciliationWorkbook
                    }
                    inputRef={inputRef}
                    onOpenRename={openRenameSheet}
                    onRefresh={() => void refreshReport()}
                    onExportReconciliation={() =>
                      void exportReconciliationWorkbook()
                    }
                    onOpenDelete={() => setIsDeleteDialogOpen(true)}
                    tourTarget={SALES_REPORT_TOUR_TARGETS.actions}
                  />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <DetailStatGrid
                  report={report}
                  tourTarget={SALES_REPORT_TOUR_TARGETS.summary}
                />
              </CardContent>
            </Card>
            <ReportNameEditor
              open={isRenameOpen}
              nameInput={nameInput}
              isSavingName={isSavingName}
              onOpenChange={setIsRenameOpen}
              onChange={setNameInput}
              onSave={() => void saveName()}
            />
            <AlertDialog
              open={isDeleteDialogOpen}
              onOpenChange={setIsDeleteDialogOpen}
            >
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete sales report?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This archives the report and its active reconciliation
                    results.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => void deleteReport()}
                  >
                    Delete report
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.75fr)]">
              <Card
                size="sm"
                className="border border-border/70"
                {...getOptionalTourTargetProps(
                  SALES_REPORT_TOUR_TARGETS.batchSelection,
                )}
              >
                <CardHeader className="gap-3 border-b border-border/60">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm">Select batches</CardTitle>
                      <CardDescription className="text-xs">
                        Eligible closed batches from the same entity with
                        completed extraction results.
                      </CardDescription>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-start sm:justify-end xl:w-auto">
                      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                        <Badge
                          variant="outline"
                          className="h-9 w-full justify-center px-3 tabular-nums sm:w-auto"
                        >
                          {selectedBatchCountLabel}
                        </Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-9 w-full justify-center bg-background px-3 sm:w-auto"
                          disabled={
                            eligibleBatches.length === 0 ||
                            isVisiblePageSelected ||
                            isRunning ||
                            isSelectingAll
                          }
                          onClick={selectVisibleBatches}
                        >
                          {isVisiblePageSelected ? (
                            <IconCheck data-icon="inline-start" />
                          ) : (
                            <IconListCheck data-icon="inline-start" />
                          )}
                          {selectPageLabel}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-9 w-full justify-center px-3 sm:w-auto"
                          disabled={
                            eligibleBatchTotal === 0 ||
                            isAllVisibleFilteredBatchesSelected ||
                            isRunning ||
                            isSelectingAll
                          }
                          onClick={() => void selectAllEligibleBatches()}
                        >
                          {isSelectingAll ? (
                            <IconLoader2
                              data-icon="inline-start"
                              className="animate-spin"
                            />
                          ) : isAllVisibleFilteredBatchesSelected ? (
                            <IconCheck data-icon="inline-start" />
                          ) : (
                            <IconSelectAll data-icon="inline-start" />
                          )}
                          {selectAllFilteredLabel}
                        </Button>
                        {selectedBatchIds.length > 0 ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 w-full justify-center bg-background px-3 sm:w-auto"
                            disabled={isRunning || isSelectingAll}
                            onClick={() => setSelectedBatchIds([])}
                          >
                            Clear
                          </Button>
                        ) : null}
                      </div>
                      <ActionTooltip
                        disabledReason={
                          selectedBatchIds.length === 0 && !isRunning
                            ? runDisabledReason
                            : ''
                        }
                      >
                        <Button
                          type="button"
                          size="sm"
                          className="h-9 w-full shrink-0 px-4 sm:w-auto sm:min-w-24"
                          disabled={
                            selectedBatchIds.length === 0 ||
                            isRunning ||
                            isSelectingAll
                          }
                          onClick={() => void runReconciliation()}
                        >
                          {isRunning ? (
                            <IconLoader2
                              data-icon="inline-start"
                              className="animate-spin"
                            />
                          ) : (
                            <IconCheck data-icon="inline-start" />
                          )}
                          {isRunning ? 'Running...' : 'Run'}
                        </Button>
                      </ActionTooltip>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="eligible" className="gap-3">
                    <TabsList className="w-full justify-start overflow-x-auto rounded-lg border border-border/70 bg-muted/20 p-1 sm:w-fit">
                      <TabsTrigger value="eligible">
                        Eligible batches
                      </TabsTrigger>
                      <TabsTrigger value="attached">
                        {`In this report (${(activeRun?.batches.length ?? 0).toLocaleString()})`}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent
                      value="eligible"
                      className="flex flex-col gap-3"
                    >
                      <form
                        className="flex flex-col gap-2 sm:flex-row"
                        onSubmit={submitBatchSearch}
                      >
                        <div className="relative flex-1">
                          <IconSearch
                            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <Input
                            className="pl-9"
                            value={batchSearchInput}
                            onChange={(event) =>
                              setBatchSearchInput(event.target.value)
                            }
                            placeholder="Search batch name, id, owner, or entity"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" variant="outline">
                            Search
                          </Button>
                          {batchQuery ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={clearBatchSearch}
                            >
                              Reset
                            </Button>
                          ) : null}
                        </div>
                      </form>
                      {eligibleBatches.length === 0 ? (
                        <EmptyPanel>
                          No eligible closed batches found for this entity.
                        </EmptyPanel>
                      ) : (
                        <div className="flex max-h-[28rem] flex-col gap-2 overflow-auto pr-1">
                          {eligibleBatches.map((batch) => {
                            const isSelected = selectedBatchIdSet.has(batch.id)

                            return (
                              <label
                                key={batch.id}
                                className={cn(
                                  'flex cursor-pointer items-center gap-3 rounded-lg border border-border/70 bg-background p-3 transition-colors hover:bg-muted/30',
                                  isSelected && 'border-primary/40 bg-muted/30',
                                )}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    toggleBatchSelection(
                                      batch.id,
                                      checked === true,
                                    )
                                  }}
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium">
                                    {batch.name ?? batch.id}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {batch.totalFiles.toLocaleString()} files ·
                                    closed {formatDateTime(batch.closedAt)}
                                  </p>
                                </div>
                                <Badge
                                  variant="outline"
                                  className={statusToneStyles.success}
                                >
                                  {batch.counts.success} ready
                                </Badge>
                              </label>
                            )
                          })}
                        </div>
                      )}
                      <BatchPagination
                        pagination={eligibleBatchPagination}
                        onPrevious={() =>
                          setBatchPage((current) => Math.max(1, current - 1))
                        }
                        onNext={() => setBatchPage((current) => current + 1)}
                      />
                    </TabsContent>
                    <TabsContent value="attached">
                      <ActiveRunBatchList
                        batches={activeRun?.batches ?? []}
                        removingBatchId={removingBatchId}
                        onRemove={(batch) => void removeBatchFromReport(batch)}
                      />
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              <Card
                size="sm"
                className="border border-border/70"
                {...getOptionalTourTargetProps(
                  SALES_REPORT_TOUR_TARGETS.runStatus,
                )}
              >
                <CardHeader className="gap-3 border-b border-border/60">
                  <CardTitle className="text-sm">Run status</CardTitle>
                  <CardDescription className="text-xs">
                    Current reconciliation totals for this report.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <MetricTile
                    label="Status"
                    value={
                      statusRun
                        ? formatStatusLabel(statusRun.status)
                        : 'Not run'
                    }
                    detail={
                      statusRun ? formatDateTime(statusRun.startedAt) : ''
                    }
                  />
                  <MetricTile
                    label="Batches"
                    value={activeRun?.selectedBatchCount ?? 0}
                    detail="Active batch set"
                  />
                  <MetricTile
                    label="Matched"
                    value={report.activeReconciliation.summary.matched.toLocaleString()}
                    detail={`${report.activeReconciliation.summary.totalRecords.toLocaleString()} active rows`}
                  />
                  <MetricTile
                    label="Variance"
                    value={formatAmount(
                      report.activeReconciliation.summary.varianceTotal,
                    )}
                    detail="Current active results"
                  />
                </CardContent>
              </Card>
            </div>

            <Card size="sm" className="border border-border/70">
              <CardHeader className="gap-3 border-b border-border/60">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm">Parsed sales rows</CardTitle>
                    <CardDescription className="text-xs">
                      Normalized rows from the active sales report version.
                    </CardDescription>
                  </div>
                  <RowsSummaryBadge report={report} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div
                  className="rounded-lg border border-border/70 bg-muted/20 p-3"
                  {...getOptionalTourTargetProps(
                    SALES_REPORT_TOUR_TARGETS.parsedRowsFilters,
                  )}
                >
                  <FieldGroup className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,180px)_auto] lg:items-end">
                    <Field>
                      <FieldLabel htmlFor="sales-report-rows-search">
                        Search
                      </FieldLabel>
                      <div className="relative">
                        <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="sales-report-rows-search"
                          className="pl-9"
                          value={parsedRowsSearchInput}
                          onChange={(event) =>
                            setParsedRowsSearchInput(event.target.value)
                          }
                          placeholder="Search customer, TIN, invoice, row, or billing month"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sales-report-rows-page-size">
                        Rows per page
                      </FieldLabel>
                      <Select
                        value={String(rowsPageSize)}
                        onValueChange={(value: string | null) => {
                          if (value) {
                            updateParsedRowsSearch({
                              rowsPageSize: Number(value),
                            })
                          }
                        }}
                      >
                        <SelectTrigger id="sales-report-rows-page-size">
                          <SelectValue placeholder="Rows per page" />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectGroup>
                            {reconciliationPageSizeOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    {hasParsedRowSearch ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          commitParsedRowsSearchInput('', () =>
                            updateParsedRowsSearch({ rowsQ: '' }),
                          )
                        }}
                      >
                        Clear
                      </Button>
                    ) : null}
                  </FieldGroup>
                </div>
                <TableShell
                  tourTarget={SALES_REPORT_TOUR_TARGETS.parsedRowsTable}
                >
                  <TableScroll>
                    <Table className="text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2">
                      <StickyTableHeader>
                        <TableRow>
                          <TableHead>Row</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>TIN</TableHead>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Billing</TableHead>
                          <TableHead className="text-right">
                            Taxable sales
                          </TableHead>
                          <TableHead className="text-right">
                            Prepaid CWT
                          </TableHead>
                        </TableRow>
                      </StickyTableHeader>
                      <TableBody>
                        {report.rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7}>
                              <EmptyPanel>
                                {hasParsedRowSearch
                                  ? 'No parsed sales rows match the current search.'
                                  : 'No parsed sales rows found.'}
                              </EmptyPanel>
                            </TableCell>
                          </TableRow>
                        ) : (
                          report.rows.map((row) => (
                            <TableRow
                              key={row.id}
                              className="odd:bg-muted/10 transition-colors hover:bg-muted/35"
                            >
                              <TableCell className="font-medium">
                                {row.rowNumber}
                              </TableCell>
                              <TableCell className="max-w-56 truncate font-medium">
                                {row.customerName}
                              </TableCell>
                              <TableCell className="font-mono text-[11px]">
                                {formatTinForDisplay(row.tin) || '—'}
                              </TableCell>
                              <TableCell className="font-mono text-[11px]">
                                {row.invoiceNumber}
                              </TableCell>
                              <TableCell className="font-mono text-[11px]">
                                {row.derivedBillingMonthMMYY}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatAmount(row.taxableSales)}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatAmount(row.prepaidCWT)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </TableScroll>
                </TableShell>
                <PanelPagination
                  pagination={report.rowsPagination}
                  itemLabel="rows"
                  tourTarget={SALES_REPORT_TOUR_TARGETS.parsedRowsPagination}
                  onPrevious={() =>
                    updateParsedRowsSearch(
                      {
                        rowsPage: Math.max(report.rowsPagination.page - 1, 1),
                      },
                      { resetPage: false },
                    )
                  }
                  onNext={() =>
                    updateParsedRowsSearch(
                      {
                        rowsPage: Math.min(
                          report.rowsPagination.page + 1,
                          report.rowsPagination.totalPages,
                        ),
                      },
                      { resetPage: false },
                    )
                  }
                />
              </CardContent>
            </Card>

            <Card size="sm" className="border border-border/70">
              <CardHeader className="gap-3 border-b border-border/60">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm">
                      Active reconciliation results
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Current non-archived results generated by this report.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {canSendReconciliationEmail &&
                    visiblePendingEmailGroupCount > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 bg-background px-3"
                        disabled={Boolean(emailingCustomerGroupKey)}
                        title="Email pending customer groups visible on this page."
                        onClick={() => void handleEmailVisiblePending()}
                      >
                        {emailingCustomerGroupKey ? (
                          <IconLoader2
                            data-icon="inline-start"
                            className="animate-spin"
                          />
                        ) : (
                          <IconMail data-icon="inline-start" />
                        )}
                        {emailingCustomerGroupKey
                          ? 'Sending...'
                          : 'Email pending'}
                        {emailingCustomerGroupKey ? null : (
                          <Badge
                            variant="secondary"
                            className="ml-1 h-5 px-1.5"
                          >
                            {visiblePendingEmailGroupCount.toLocaleString()}
                          </Badge>
                        )}
                      </Button>
                    ) : null}
                    <ResultsSummaryBadges report={report} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div
                  className="rounded-lg border border-border/70 bg-muted/20 p-3"
                  {...getOptionalTourTargetProps(
                    SALES_REPORT_TOUR_TARGETS.resultsFilters,
                  )}
                >
                  <FieldGroup className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,220px)_minmax(0,180px)_auto] xl:items-end">
                    <Field>
                      <FieldLabel htmlFor="sales-report-results-search">
                        Search
                      </FieldLabel>
                      <div className="relative">
                        <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="sales-report-results-search"
                          className="pl-9"
                          value={resultsSearchInput}
                          onChange={(event) =>
                            setResultsSearchInput(event.target.value)
                          }
                          placeholder="Search customer, TIN, invoice, or transaction line"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sales-report-results-filter">
                        Filter
                      </FieldLabel>
                      <Select
                        value={resultsFilter}
                        onValueChange={(value: string | null) => {
                          if (value) {
                            updateResultSearch({
                              filter: value as ReconciliationTableFilterValue,
                            })
                          }
                        }}
                      >
                        <SelectTrigger id="sales-report-results-filter">
                          <SelectValue placeholder="Filter results" />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectGroup>
                            {reconciliationTableFilterOptions.map((option) => (
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
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="sales-report-results-page-size">
                        Rows per page
                      </FieldLabel>
                      <Select
                        value={String(resultsPageSize)}
                        onValueChange={(value: string | null) => {
                          if (value) {
                            updateResultSearch({ pageSize: Number(value) })
                          }
                        }}
                      >
                        <SelectTrigger id="sales-report-results-page-size">
                          <SelectValue placeholder="Rows per page" />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectGroup>
                            {reconciliationPageSizeOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    {hasResultFilters ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          commitResultsSearchInput('', () =>
                            updateResultSearch({ q: '', filter: 'all' }),
                          )
                        }}
                      >
                        Clear
                      </Button>
                    ) : null}
                  </FieldGroup>
                </div>
                <ReconciliationResultsTable
                  rows={report.activeReconciliation.rows}
                  density="compact"
                  tourTarget={SALES_REPORT_TOUR_TARGETS.resultsTable}
                  selectedRowId={selectedResultId}
                  emailingCustomerGroupKey={emailingCustomerGroupKey}
                  emptyMessage={
                    hasResultFilters
                      ? 'No reconciliation results match the current filters.'
                      : 'No reconciliation results yet.'
                  }
                  emptyDescription={
                    hasResultFilters
                      ? 'Adjust the search or filter to widen this result set.'
                      : 'Select one or more batches and run reconciliation.'
                  }
                  onEmailRow={
                    canSendReconciliationEmail
                      ? (row) => void handleSendEmail(row)
                      : undefined
                  }
                  onRowSelect={(row) => {
                    setSelectedResultId(row.id)
                    setResultDrawerOpen(true)
                  }}
                />
                <PanelPagination
                  pagination={report.activeReconciliation.pagination}
                  itemLabel="results"
                  tourTarget={SALES_REPORT_TOUR_TARGETS.resultsPagination}
                  onPrevious={() =>
                    updateResultSearch(
                      {
                        page: Math.max(
                          (report.activeReconciliation.pagination?.page ??
                            resultsPage) - 1,
                          1,
                        ),
                      },
                      { resetPage: false },
                    )
                  }
                  onNext={() =>
                    updateResultSearch(
                      {
                        page: Math.min(
                          (report.activeReconciliation.pagination?.page ??
                            resultsPage) + 1,
                          report.activeReconciliation.pagination?.totalPages ??
                            resultsPage,
                        ),
                      },
                      { resetPage: false },
                    )
                  }
                />
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
      {selectedResultRow ? (
        <ReconciliationDetailDrawer
          open={resultDrawerOpen}
          onOpenChange={setResultDrawerOpen}
          row={selectedResultRow}
          onEmailRow={
            canSendReconciliationEmail
              ? (row) => void handleSendEmail(row)
              : undefined
          }
          emailingCustomerGroupKey={emailingCustomerGroupKey}
        />
      ) : null}
      {report ? <SalesReportTour startSignal={tourStartSignal} /> : null}
    </AppShell>
  )
}
