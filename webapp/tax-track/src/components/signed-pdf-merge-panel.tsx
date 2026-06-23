import {
  IconAlertCircle,
  IconBuilding,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClockHour4,
  IconDownload,
  IconFileCheck,
  IconFileTypePdf,
  IconFolder,
  IconListDetails,
  IconLoader2,
  IconRefresh,
  IconSearch,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Icon } from '@tabler/icons-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getProductTourTargetProps } from '@/lib/product-tours'
import { cn } from '@/lib/utils'

type MergeEntity = {
  id: number
  shortName: string
  companyName: string | null
  tin: string | null
  hasValidTin: boolean
}

type MergeBatchOption = {
  id: string
  name: string | null
  status: string
  closedAt: string | null
  lastActivityAt: string | null
  createdAt: string | null
  eligibleSignedPdfCount: number
}

type MergePreviewPart = {
  partNumber: number
  fileName: string
  sizeBytes: number
  inputCount: number
}

type MergePreviewCandidate = {
  documentResultId: number
  fileName: string
  certificatePeriod: string
  assignedPeriod: string
  isLate: boolean
  assignmentReason: string
}

type MergePreview = {
  totalInputFiles: number
  totalSizeBytes: number
  outputCount: number
  lateInputCount: number
  candidateRows: Array<MergePreviewCandidate>
  parts: Array<MergePreviewPart>
}

type MergeJobOutput = {
  partNumber: number
  fileName: string
  sizeBytes: number | null
  inputCount: number
  status: string
  downloadReady: boolean
}

type MergeJob = {
  id: string
  payeeShortName: string
  entityTin: string
  periodType: string
  year: number
  quarter: number | null
  status: string
  awsBatchStatus: string | null
  totalInputFiles: number
  totalSizeBytes: number
  outputCount: number
  errorMessage: string | null
  createdAt: string | null
  updatedAt: string | null
  outputs: Array<MergeJobOutput>
}

type MergeSummary = {
  totalJobs: number
  activeJobs: number
  readyDownloads: number
}

type MergePagination = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

type OptionsResponse = {
  entities?: Array<MergeEntity>
  batches?: Array<MergeBatchOption>
  error?: string
}

type PreviewResponse = {
  preview?: MergePreview
  error?: string
}

type JobsResponse = {
  jobs?: Array<MergeJob>
  job?: MergeJob
  summary?: MergeSummary
  pagination?: MergePagination
  error?: string
}

type DownloadResponse = {
  download?: {
    url: string
    fileName: string
    expiresIn: number
  }
  error?: string
}

type WorkflowStep = 1 | 2 | 3
type AllJobsStatusFilter = 'all' | 'active' | 'ready' | 'failed'
type AllJobsPeriodFilter = 'all' | 'annual' | 'quarterly'
type AllJobsSort = 'updated-desc' | 'created-desc' | 'entity-asc'

const CURRENT_YEAR = new Date().getFullYear()
const ACTIVE_JOB_STATUSES = new Set(['pending', 'submitted', 'running'])
const ALL_JOBS_PAGE_SIZE = 25
const ALL_JOBS_STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'ready', label: 'Ready' },
  { value: 'failed', label: 'Failed' },
] as const satisfies Array<{
  value: AllJobsStatusFilter
  label: string
}>
const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'
const PANEL_BORDER_CLASS = 'border-border/60'
const MERGE_SELECT_CONTENT_PROPS = {
  align: 'start',
  alignItemWithTrigger: false,
  className:
    'min-w-[var(--anchor-width)] rounded-md border border-border/70 bg-background',
} as const
const MERGE_SELECT_TRIGGER_CLASS = 'rounded-md bg-background'
const MERGE_SELECT_ITEM_CLASS =
  'min-h-8 rounded-none bg-background py-2 pl-3 pr-9 text-sm hover:bg-background focus:bg-background focus:text-foreground data-[highlighted]:bg-background data-[selected]:bg-background'
const MERGE_INPUT_CLASS = 'h-8 rounded-md bg-background text-sm'
const MERGE_TOGGLE_GROUP_CLASS =
  'grid h-8 w-full grid-cols-2 overflow-hidden rounded-md border border-border/70 bg-background data-[spacing=0]:data-[variant=outline]:rounded-md'
const MERGE_TOGGLE_ITEM_CLASS =
  'min-w-0 rounded-none border-0 bg-background text-xs hover:bg-background aria-pressed:bg-background aria-pressed:text-primary data-[state=on]:bg-background data-[state=on]:text-primary group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-none group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-none group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-none group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-none'
const EMPTY_SUMMARY: MergeSummary = {
  totalJobs: 0,
  activeJobs: 0,
  readyDownloads: 0,
}

const formatBytes = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return '-'
  }

  if (value < 1_000) return `${value} B`
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)} KB`
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`
  return `${(value / 1_000_000_000).toFixed(2)} GB`
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) {
    return '-'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

const formatPartNumber = (partNumber: number) =>
  String(partNumber).padStart(2, '0')

const formatJobId = (job: MergeJob) => job.id.slice(0, 8)

const formatJobPeriod = (job: MergeJob) =>
  job.periodType === 'annual'
    ? `TY ${job.year}`
    : `${job.quarter ?? '-'}Q ${job.year}`

const getReadyOutputs = (job: MergeJob) =>
  job.outputs.filter((output) => output.downloadReady)

const getExpectedOutputCount = (job: MergeJob) =>
  Math.max(job.outputCount, job.outputs.length)

const getJobUpdatedTime = (job: MergeJob) =>
  new Date(job.updatedAt ?? job.createdAt ?? 0).getTime()

const getJobCreatedTime = (job: MergeJob) =>
  new Date(job.createdAt ?? job.updatedAt ?? 0).getTime()

const statusLabel = (status: string) => {
  switch (status) {
    case 'succeeded':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'running':
    case 'submitted':
      return 'Processing'
    default:
      return 'Pending'
  }
}

const statusClassName = (status: string) => {
  switch (status) {
    case 'succeeded':
      return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700'
    case 'failed':
      return 'border-rose-500/30 bg-rose-500/15 text-rose-700'
    case 'running':
    case 'submitted':
      return 'border-amber-500/30 bg-amber-500/15 text-amber-700'
    default:
      return 'border-border bg-muted/40 text-muted-foreground'
  }
}

const jobMatchesStatusFilter = (job: MergeJob, filter: AllJobsStatusFilter) => {
  switch (filter) {
    case 'active':
      return ACTIVE_JOB_STATUSES.has(job.status)
    case 'ready':
      return getReadyOutputs(job).length > 0
    case 'failed':
      return job.status === 'failed'
    default:
      return true
  }
}

const jobMatchesSearch = (job: MergeJob, query: string) => {
  if (!query) return true

  const haystack = [
    job.id,
    job.payeeShortName,
    job.entityTin,
    formatJobPeriod(job),
    job.status,
  ]
    .join(' ')
    .toLowerCase()

  return haystack.includes(query)
}

const compareMergeJobs =
  (sort: AllJobsSort) => (left: MergeJob, right: MergeJob) => {
    switch (sort) {
      case 'created-desc':
        return getJobCreatedTime(right) - getJobCreatedTime(left)
      case 'entity-asc':
        return left.payeeShortName.localeCompare(right.payeeShortName)
      default:
        return getJobUpdatedTime(right) - getJobUpdatedTime(left)
    }
  }

const readJson = async <T,>(response: Response): Promise<T | null> =>
  (await response.json().catch(() => null)) as T | null

const getOptionalTourTargetProps = (targetId?: string) =>
  targetId ? getProductTourTargetProps(targetId) : {}

function WorkflowSteps({ currentStep }: { currentStep: WorkflowStep }) {
  const steps = [
    { id: 1, label: 'Select scope' },
    { id: 2, label: 'Preview split' },
    { id: 3, label: 'Submit job' },
  ] as const

  return (
    <div
      role="list"
      aria-label="Merge workflow"
      className="grid gap-2 md:grid-cols-3"
    >
      {steps.map((step) => {
        const isActive = currentStep === step.id
        const isComplete = currentStep > step.id

        return (
          <div
            key={step.id}
            role="listitem"
            aria-current={isActive ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
              PANEL_BORDER_CLASS,
              isActive || isComplete
                ? 'border-primary/30 bg-primary/5 text-primary'
                : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold',
                isActive || isComplete
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-muted',
              )}
            >
              {isComplete ? <IconCheck className="size-3" /> : step.id}
            </span>
            <span className="truncate font-medium">{step.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function MetricTile({
  icon: IconComponent,
  label,
  value,
  unit,
}: {
  icon: Icon
  label: string
  value: string | number
  unit: string
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-lg border bg-muted/20 p-3',
        PANEL_BORDER_CLASS,
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-primary">
        <IconComponent className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-muted-foreground">
          {label}
        </p>
        <p className="flex min-w-0 items-baseline gap-1 text-base font-semibold leading-tight">
          <span className="truncate tabular-nums">{value}</span>
          {unit ? (
            <span className="shrink-0 whitespace-nowrap text-xs font-normal text-muted-foreground">
              {unit}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const isProcessing = status === 'running' || status === 'submitted'

  return (
    <Badge variant="outline" className={statusClassName(status)}>
      {status === 'failed' ? <IconAlertCircle /> : null}
      {status === 'succeeded' ? <IconCheck /> : null}
      {isProcessing ? <IconLoader2 className="animate-spin" /> : null}
      {statusLabel(status)}
    </Badge>
  )
}

function JobTable({
  jobs,
  isLoading,
  emptyMessage,
  onDownload,
  className,
  allowHorizontalScroll = true,
}: {
  jobs: Array<MergeJob>
  isLoading: boolean
  emptyMessage: string
  onDownload: (jobId: string, partNumber: number) => void
  className?: string
  allowHorizontalScroll?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border',
        allowHorizontalScroll
          ? 'overflow-x-auto'
          : 'overflow-visible [&_[data-slot=table-container]]:overflow-visible',
        PANEL_BORDER_CLASS,
        className,
      )}
    >
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead className="h-9 px-2">Job ID</TableHead>
            <TableHead className="h-9 px-2">Entity</TableHead>
            <TableHead className="h-9 px-2">Period</TableHead>
            <TableHead className="h-9 px-2">Status</TableHead>
            <TableHead className="h-9 px-2">Files</TableHead>
            <TableHead className="h-9 px-2">Updated</TableHead>
            <TableHead className="h-9 px-2 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && jobs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <IconLoader2 className="animate-spin" />
                  Loading merge jobs
                </span>
              </TableCell>
            </TableRow>
          ) : null}
          {!isLoading && jobs.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : null}
          {jobs.map((job) => {
            const readyOutputs = getReadyOutputs(job)
            const expectedOutputs = Math.max(
              job.outputCount,
              job.outputs.length,
            )

            return (
              <TableRow key={job.id}>
                <TableCell className="px-2 py-2 font-medium" title={job.id}>
                  {formatJobId(job)}
                </TableCell>
                <TableCell className="px-2 py-2">
                  {job.payeeShortName}
                </TableCell>
                <TableCell className="px-2 py-2">
                  {formatJobPeriod(job)}
                </TableCell>
                <TableCell className="px-2 py-2">
                  <StatusBadge status={job.status} />
                </TableCell>
                <TableCell className="px-2 py-2">
                  {readyOutputs.length} / {expectedOutputs}
                </TableCell>
                <TableCell className="min-w-32 px-2 py-2">
                  {formatDateTime(job.updatedAt ?? job.createdAt)}
                </TableCell>
                <TableCell className="px-2 py-2">
                  <div className="flex justify-end gap-1.5">
                    {readyOutputs.length > 0 ? (
                      readyOutputs.map((output) => (
                        <Button
                          key={output.partNumber}
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          title={`Download part ${formatPartNumber(
                            output.partNumber,
                          )}`}
                          onClick={() => {
                            onDownload(job.id, output.partNumber)
                          }}
                        >
                          <IconDownload data-icon="inline-start" />
                          <span className="sr-only">
                            Download part {formatPartNumber(output.partNumber)}
                          </span>
                        </Button>
                      ))
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled
                        title="Downloads are not ready"
                      >
                        <IconDownload data-icon="inline-start" />
                        <span className="sr-only">Downloads are not ready</span>
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function HistorySummaryTile({
  label,
  value,
  helper,
}: {
  label: string
  value: number
  helper: string
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold leading-tight tabular-nums">
        {value.toLocaleString()}
      </p>
      <p className="truncate text-xs text-muted-foreground">{helper}</p>
    </div>
  )
}

function AllMergeJobsTable({
  jobs,
  isLoading,
  emptyMessage,
  expandedJobId,
  onExpandedJobChange,
  onDownload,
}: {
  jobs: Array<MergeJob>
  isLoading: boolean
  emptyMessage: string
  expandedJobId: string | null
  onExpandedJobChange: (jobId: string | null) => void
  onDownload: (jobId: string, partNumber: number) => void
}) {
  return (
    <div className={cn('rounded-lg border', PANEL_BORDER_CLASS)}>
      <Table className="min-w-[980px] text-xs">
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead className="h-9 w-[170px] px-2">Status</TableHead>
            <TableHead className="h-9 w-[190px] px-2">Entity / TIN</TableHead>
            <TableHead className="h-9 w-[110px] px-2">Period</TableHead>
            <TableHead className="h-9 w-[90px] px-2">Inputs</TableHead>
            <TableHead className="h-9 w-[110px] px-2">Outputs</TableHead>
            <TableHead className="h-9 w-[110px] px-2">Size</TableHead>
            <TableHead className="h-9 w-[150px] px-2">Updated</TableHead>
            <TableHead className="h-9 w-[120px] px-2 text-right">
              Downloads
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && jobs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="h-28 text-center">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <IconLoader2 className="animate-spin" />
                  Loading merge job history
                </span>
              </TableCell>
            </TableRow>
          ) : null}
          {!isLoading && jobs.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="h-28 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : null}
          {jobs.map((job) => {
            const readyOutputs = getReadyOutputs(job)
            const expectedOutputs = getExpectedOutputCount(job)
            const isExpanded = expandedJobId === job.id

            return (
              <Fragment key={job.id}>
                <TableRow>
                  <TableCell className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-expanded={isExpanded}
                        title={
                          isExpanded
                            ? 'Collapse job details'
                            : 'Expand job details'
                        }
                        onClick={() => {
                          onExpandedJobChange(isExpanded ? null : job.id)
                        }}
                      >
                        {isExpanded ? (
                          <IconChevronDown data-icon="inline-start" />
                        ) : (
                          <IconChevronRight data-icon="inline-start" />
                        )}
                        <span className="sr-only">
                          {isExpanded
                            ? 'Collapse job details'
                            : 'Expand job details'}
                        </span>
                      </Button>
                      <div className="flex min-w-0 flex-col gap-1">
                        <StatusBadge status={job.status} />
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {formatJobId(job)}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {job.payeeShortName}
                      </p>
                      <p className="truncate text-muted-foreground">
                        {formatTinForDisplay(job.entityTin) || job.entityTin}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    {formatJobPeriod(job)}
                  </TableCell>
                  <TableCell className="px-2 py-2 tabular-nums">
                    {job.totalInputFiles.toLocaleString()}
                  </TableCell>
                  <TableCell className="px-2 py-2 tabular-nums">
                    {readyOutputs.length} / {expectedOutputs}
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    {formatBytes(job.totalSizeBytes)}
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    {formatDateTime(job.updatedAt ?? job.createdAt)}
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    <div className="flex justify-end gap-1.5">
                      {readyOutputs.length > 0 ? (
                        readyOutputs.map((output) => (
                          <Button
                            key={output.partNumber}
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            title={`Download part ${formatPartNumber(
                              output.partNumber,
                            )}`}
                            onClick={() => {
                              onDownload(job.id, output.partNumber)
                            }}
                          >
                            <IconDownload data-icon="inline-start" />
                            <span className="sr-only">
                              Download part{' '}
                              {formatPartNumber(output.partNumber)}
                            </span>
                          </Button>
                        ))
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled
                          title="Downloads are not ready"
                        >
                          <IconDownload data-icon="inline-start" />
                          <span className="sr-only">
                            Downloads are not ready
                          </span>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {isExpanded ? (
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={8} className="p-0">
                      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(260px,0.85fr)_minmax(420px,1.15fr)]">
                        <div className="rounded-md border border-border/60 bg-background p-3">
                          <p className="text-xs font-semibold uppercase text-muted-foreground">
                            Job details
                          </p>
                          <dl className="mt-3 grid gap-2 text-xs">
                            <div className="grid gap-1">
                              <dt className="text-muted-foreground">
                                Full job ID
                              </dt>
                              <dd className="break-all font-mono">{job.id}</dd>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <dt className="text-muted-foreground">
                                  Created
                                </dt>
                                <dd>{formatDateTime(job.createdAt)}</dd>
                              </div>
                              <div>
                                <dt className="text-muted-foreground">
                                  Updated
                                </dt>
                                <dd>{formatDateTime(job.updatedAt)}</dd>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <dt className="text-muted-foreground">
                                  AWS status
                                </dt>
                                <dd>{job.awsBatchStatus ?? '-'}</dd>
                              </div>
                              <div>
                                <dt className="text-muted-foreground">
                                  Output parts
                                </dt>
                                <dd>{expectedOutputs.toLocaleString()}</dd>
                              </div>
                            </div>
                          </dl>
                        </div>
                        <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-background p-3">
                          {job.errorMessage ? (
                            <Alert variant="destructive">
                              <IconAlertCircle />
                              <AlertTitle>Merge job failed</AlertTitle>
                              <AlertDescription>
                                {job.errorMessage}
                              </AlertDescription>
                            </Alert>
                          ) : null}
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold uppercase text-muted-foreground">
                              Output files
                            </p>
                            <Badge variant="outline">
                              {readyOutputs.length} ready
                            </Badge>
                          </div>
                          {job.outputs.length > 0 ? (
                            <div className="grid gap-2">
                              {job.outputs.map((output) => (
                                <div
                                  key={output.partNumber}
                                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-2"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate font-medium">
                                      Part {formatPartNumber(output.partNumber)}
                                    </p>
                                    <p
                                      className="truncate text-muted-foreground"
                                      title={output.fileName}
                                    >
                                      {output.fileName}
                                    </p>
                                    <p className="text-muted-foreground">
                                      {output.inputCount.toLocaleString()} PDFs
                                      · {formatBytes(output.sizeBytes)}
                                    </p>
                                  </div>
                                  {output.downloadReady ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        onDownload(job.id, output.partNumber)
                                      }}
                                    >
                                      <IconDownload data-icon="inline-start" />
                                      Download
                                    </Button>
                                  ) : (
                                    <Badge variant="outline">
                                      {output.status}
                                    </Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                              Output metadata is not available yet.
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function LateCertificateTable({
  rows,
}: {
  rows: Array<MergePreviewCandidate>
}) {
  const lateRows = rows.filter((row) => row.isLate)
  if (lateRows.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <Alert>
        <IconAlertCircle />
        <AlertTitle>Late certificates included</AlertTitle>
        <AlertDescription>
          These certificates keep their original certificate period but will be
          included in this selected merge package.
        </AlertDescription>
      </Alert>
      <div className={cn('rounded-lg border', PANEL_BORDER_CLASS)}>
        <Table className="min-w-[640px] text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 w-[220px] px-2">Certificate</TableHead>
              <TableHead className="h-9 w-[140px] px-2">
                Certificate period
              </TableHead>
              <TableHead className="h-9 px-2">Merge package</TableHead>
              <TableHead className="h-9 w-[88px] px-2">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lateRows.map((row) => (
              <TableRow key={row.documentResultId}>
                <TableCell className="max-w-52 truncate px-2 py-2 font-medium">
                  {row.fileName}
                </TableCell>
                <TableCell className="px-2 py-2">
                  {row.certificatePeriod}
                </TableCell>
                <TableCell className="px-2 py-2">
                  <div className="flex flex-col gap-0.5">
                    <span>{row.assignedPeriod}</span>
                    <span className="whitespace-normal leading-snug text-muted-foreground">
                      {row.certificatePeriod} certificate included in{' '}
                      {row.assignedPeriod} package.
                    </span>
                  </div>
                </TableCell>
                <TableCell className="px-2 py-2">
                  <Badge variant="outline">Late</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export function SignedPdfMergePanel({
  canExportPdf,
  tourTargets,
}: {
  canExportPdf: boolean
  tourTargets?: {
    controls?: string
    preview?: string
    recentJobs?: string
    submitActions?: string
    summary?: string
    workflow?: string
  }
}) {
  const [entities, setEntities] = useState<Array<MergeEntity>>([])
  const [jobs, setJobs] = useState<Array<MergeJob>>([])
  const [summary, setSummary] = useState<MergeSummary>(EMPTY_SUMMARY)
  const [payeeShortName, setPayeeShortName] = useState('')
  const [periodType, setPeriodType] = useState<'annual' | 'quarterly'>(
    'quarterly',
  )
  const [year, setYear] = useState(String(CURRENT_YEAR))
  const [quarter, setQuarter] = useState('1')
  const [batchOptions, setBatchOptions] = useState<Array<MergeBatchOption>>([])
  const [selectedBatchIds, setSelectedBatchIds] = useState<Array<string>>([])
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>(1)
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [isLoadingBatchOptions, setIsLoadingBatchOptions] = useState(false)
  const [isLoadingJobs, setIsLoadingJobs] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [batchOptionsError, setBatchOptionsError] = useState('')
  const [allJobsOpen, setAllJobsOpen] = useState(false)
  const [allJobs, setAllJobs] = useState<Array<MergeJob>>([])
  const [allJobsPagination, setAllJobsPagination] =
    useState<MergePagination | null>(null)
  const [allJobsPage, setAllJobsPage] = useState(1)
  const [isLoadingAllJobs, setIsLoadingAllJobs] = useState(false)
  const [allJobsError, setAllJobsError] = useState('')
  const [allJobsQuery, setAllJobsQuery] = useState('')
  const [allJobsStatusFilter, setAllJobsStatusFilter] =
    useState<AllJobsStatusFilter>('all')
  const [allJobsPeriodFilter, setAllJobsPeriodFilter] =
    useState<AllJobsPeriodFilter>('all')
  const [allJobsSort, setAllJobsSort] = useState<AllJobsSort>('updated-desc')
  const [expandedAllJobsJobId, setExpandedAllJobsJobId] = useState<
    string | null
  >(null)

  const selectedEntity = useMemo(
    () => entities.find((entity) => entity.shortName === payeeShortName),
    [entities, payeeShortName],
  )

  const periodPayload = useMemo(() => {
    const parsedYear = Number.parseInt(year, 10)
    const parsedQuarter = Number.parseInt(quarter, 10)

    return {
      payeeShortName,
      periodType,
      year: parsedYear,
      ...(periodType === 'quarterly' ? { quarter: parsedQuarter } : {}),
    }
  }, [payeeShortName, periodType, year, quarter])

  const requestPayload = useMemo(
    () => ({
      ...periodPayload,
      batchIds: selectedBatchIds,
    }),
    [periodPayload, selectedBatchIds],
  )

  const selectedBatchIdSet = useMemo(
    () => new Set(selectedBatchIds),
    [selectedBatchIds],
  )
  const isValidPeriodSelection =
    Number.isInteger(periodPayload.year) &&
    periodPayload.year >= 2000 &&
    periodPayload.year <= 2100 &&
    (periodType === 'annual' ||
      (Number.isInteger(periodPayload.quarter) &&
        periodPayload.quarter >= 1 &&
        periodPayload.quarter <= 4))
  const canLoadBatchOptions =
    canExportPdf &&
    Boolean(payeeShortName) &&
    selectedEntity?.hasValidTin === true &&
    isValidPeriodSelection
  const hasActiveJobs =
    summary.activeJobs > 0 ||
    jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))
  const selectedPeriodLabel =
    periodType === 'annual' ? `TY ${year || '-'}` : `${quarter}Q ${year || '-'}`
  const canPreview =
    canExportPdf &&
    Boolean(payeeShortName) &&
    isValidPeriodSelection &&
    selectedEntity?.hasValidTin === true &&
    selectedBatchIds.length > 0 &&
    !isLoadingBatchOptions
  const canSubmit = Boolean(preview) && canPreview && !isSubmitting
  const packageActionHint =
    selectedEntity?.hasValidTin === false
      ? 'Entity TIN is invalid'
      : !canLoadBatchOptions
        ? 'Select a valid entity and period'
        : selectedBatchIds.length === 0
          ? 'Select at least one eligible batch'
          : !preview
            ? 'Preview the package before submitting'
            : 'Package preview is ready to submit'
  const normalizedAllJobsQuery = allJobsQuery.trim().toLowerCase()
  const filteredAllJobs = useMemo(() => {
    const nextJobs = allJobs.filter(
      (job) =>
        jobMatchesSearch(job, normalizedAllJobsQuery) &&
        jobMatchesStatusFilter(job, allJobsStatusFilter) &&
        (allJobsPeriodFilter === 'all' ||
          job.periodType === allJobsPeriodFilter),
    )

    return [...nextJobs].sort(compareMergeJobs(allJobsSort))
  }, [
    allJobs,
    allJobsPeriodFilter,
    allJobsSort,
    allJobsStatusFilter,
    normalizedAllJobsQuery,
  ])
  const hasAllJobsFilters =
    normalizedAllJobsQuery.length > 0 ||
    allJobsStatusFilter !== 'all' ||
    allJobsPeriodFilter !== 'all'
  const allJobsFailedOnPage = allJobs.filter(
    (job) => job.status === 'failed',
  ).length
  const allJobsPaginationPage = allJobsPagination?.page ?? allJobsPage
  const allJobsPaginationPageSize =
    allJobsPagination?.pageSize ?? ALL_JOBS_PAGE_SIZE
  const allJobsTotalItems = allJobsPagination?.totalItems ?? summary.totalJobs
  const allJobsShowingStart =
    allJobsTotalItems === 0
      ? 0
      : (allJobsPaginationPage - 1) * allJobsPaginationPageSize + 1
  const allJobsShowingEnd =
    allJobsTotalItems === 0
      ? 0
      : Math.min(
          allJobsTotalItems,
          (allJobsPaginationPage - 1) * allJobsPaginationPageSize +
            allJobs.length,
        )

  const loadOptions = useCallback(async () => {
    if (!canExportPdf) {
      return
    }

    setIsLoadingOptions(true)
    try {
      const response = await fetch('/api/merge-jobs/options')
      const payload = await readJson<OptionsResponse>(response)
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to load merge options.')
      }

      const nextEntities = payload?.entities ?? []
      setEntities(nextEntities)
      setPayeeShortName(
        (current) => current || nextEntities[0]?.shortName || '',
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Unable to load options.',
      )
    } finally {
      setIsLoadingOptions(false)
    }
  }, [canExportPdf])

  const loadBatchOptions = useCallback(async () => {
    if (!canLoadBatchOptions) {
      setBatchOptions([])
      return
    }

    setIsLoadingBatchOptions(true)
    setBatchOptionsError('')
    try {
      const params = new URLSearchParams({
        payeeShortName,
        periodType,
        year: String(periodPayload.year),
      })
      if (periodType === 'quarterly') {
        params.set('quarter', String(periodPayload.quarter))
      }

      const response = await fetch(
        `/api/merge-jobs/options?${params.toString()}`,
      )
      const payload = await readJson<OptionsResponse>(response)
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to load upload batches.')
      }

      const nextBatchOptions = payload?.batches ?? []
      const nextBatchIds = new Set(nextBatchOptions.map((batch) => batch.id))
      setBatchOptions(nextBatchOptions)
      setSelectedBatchIds((current) =>
        current.filter((batchId) => nextBatchIds.has(batchId)),
      )
      if (payload?.entities) {
        setEntities(payload.entities)
      }
    } catch (error) {
      setBatchOptions([])
      setSelectedBatchIds([])
      setBatchOptionsError(
        error instanceof Error
          ? error.message
          : 'Unable to load upload batches.',
      )
    } finally {
      setIsLoadingBatchOptions(false)
    }
  }, [
    canLoadBatchOptions,
    payeeShortName,
    periodPayload.quarter,
    periodPayload.year,
    periodType,
  ])

  const loadJobs = useCallback(async () => {
    if (!canExportPdf) {
      return
    }

    setIsLoadingJobs(true)
    try {
      const response = await fetch('/api/merge-jobs?view=recent')
      const payload = await readJson<JobsResponse>(response)
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to load merge jobs.')
      }

      setJobs(payload?.jobs ?? [])
      setSummary(payload?.summary ?? EMPTY_SUMMARY)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Unable to load jobs.',
      )
    } finally {
      setIsLoadingJobs(false)
    }
  }, [canExportPdf])

  const loadAllJobs = useCallback(
    async (page: number) => {
      if (!canExportPdf) {
        return
      }

      setIsLoadingAllJobs(true)
      setAllJobsError('')
      try {
        const params = new URLSearchParams({
          view: 'all',
          page: String(page),
          pageSize: String(ALL_JOBS_PAGE_SIZE),
        })
        const response = await fetch(`/api/merge-jobs?${params.toString()}`)
        const payload = await readJson<JobsResponse>(response)
        if (!response.ok) {
          throw new Error(payload?.error || 'Unable to load job history.')
        }

        setAllJobs(payload?.jobs ?? [])
        setSummary(payload?.summary ?? EMPTY_SUMMARY)
        setAllJobsPagination(payload?.pagination ?? null)
        setExpandedAllJobsJobId(null)
      } catch (error) {
        setAllJobsError(
          error instanceof Error
            ? error.message
            : 'Unable to load job history.',
        )
      } finally {
        setIsLoadingAllJobs(false)
      }
    },
    [canExportPdf],
  )

  const toggleBatchSelection = useCallback(
    (batchId: string, selected: boolean) => {
      setSelectedBatchIds((current) => {
        if (selected) {
          return current.includes(batchId) ? current : [...current, batchId]
        }

        return current.filter((currentBatchId) => currentBatchId !== batchId)
      })
    },
    [],
  )

  const selectAllBatchOptions = useCallback(() => {
    setSelectedBatchIds(batchOptions.map((batch) => batch.id))
  }, [batchOptions])

  const clearBatchSelection = useCallback(() => {
    setSelectedBatchIds([])
  }, [])

  useEffect(() => {
    void loadOptions()
    void loadJobs()
  }, [loadJobs, loadOptions])

  useEffect(() => {
    setBatchOptions([])
    setSelectedBatchIds([])
    setBatchOptionsError('')
    setPreview(null)
    setPreviewError('')
    setWorkflowStep(1)

    if (canLoadBatchOptions) {
      void loadBatchOptions()
    }
  }, [
    canLoadBatchOptions,
    loadBatchOptions,
    payeeShortName,
    periodType,
    quarter,
    year,
  ])

  useEffect(() => {
    if (!hasActiveJobs) {
      return
    }

    const timer = window.setInterval(() => {
      void loadJobs()
      if (allJobsOpen) {
        void loadAllJobs(allJobsPage)
      }
    }, 7_000)

    return () => window.clearInterval(timer)
  }, [allJobsOpen, allJobsPage, hasActiveJobs, loadAllJobs, loadJobs])

  useEffect(() => {
    if (!allJobsOpen) {
      return
    }

    void loadAllJobs(allJobsPage)
  }, [allJobsOpen, allJobsPage, loadAllJobs])

  useEffect(() => {
    setPreview(null)
    setPreviewError('')
    setWorkflowStep(1)
  }, [requestPayload])

  const previewMerge = async () => {
    setPreviewError('')
    setIsPreviewing(true)

    try {
      const response = await fetch('/api/merge-jobs/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      })
      const payload = await readJson<PreviewResponse>(response)
      if (!response.ok || !payload?.preview) {
        throw new Error(payload?.error || 'Unable to preview merge.')
      }

      setPreview(payload.preview)
      setWorkflowStep(2)
    } catch (error) {
      setPreviewError(
        error instanceof Error ? error.message : 'Unable to preview merge.',
      )
    } finally {
      setIsPreviewing(false)
    }
  }

  const submitMerge = async () => {
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/merge-jobs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      })
      const payload = await readJson<JobsResponse>(response)
      if (!response.ok || !payload?.job) {
        throw new Error(payload?.error || 'Unable to submit merge job.')
      }

      setJobs((current) => [payload.job as MergeJob, ...current].slice(0, 5))
      setPreview(null)
      setWorkflowStep(3)
      toast.success('Merge job submitted.')
      void loadJobs()
      if (allJobsOpen) {
        setAllJobsPage(1)
        void loadAllJobs(1)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to submit merge job.'
      setPreview(null)
      setPreviewError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const downloadOutput = useCallback(
    async (jobId: string, partNumber: number) => {
      try {
        const response = await fetch(
          `/api/merge-jobs/${encodeURIComponent(jobId)}/outputs/${partNumber}`,
        )
        const payload = await readJson<DownloadResponse>(response)
        if (!response.ok || !payload?.download?.url) {
          throw new Error(payload?.error || 'Unable to prepare download.')
        }

        window.location.assign(payload.download.url)
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Unable to prepare download.',
        )
      }
    },
    [],
  )

  if (!canExportPdf) {
    return (
      <Alert>
        <IconFileTypePdf />
        <AlertTitle>PDF export access required</AlertTitle>
        <AlertDescription>
          Your account cannot create or download signed 2307 merge outputs.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(560px,1.35fr)_minmax(380px,0.65fr)]">
        <Card
          size="sm"
          className={PANEL_CARD_CLASS}
          aria-label="Build merge package"
        >
          <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
            <div className="min-w-0">
              <CardTitle className="text-sm">Build merge package</CardTitle>
              <CardDescription className="text-xs">
                Choose the entity, reporting period, and closed upload batches
                to include in this official signed PDF package.
              </CardDescription>
            </div>
            <div {...getOptionalTourTargetProps(tourTargets?.workflow)}>
              <WorkflowSteps currentStep={workflowStep} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <section
              aria-label="Scope controls"
              className={cn(
                'flex flex-col gap-3 rounded-lg border bg-muted/10 p-3',
                PANEL_BORDER_CLASS,
              )}
              {...getOptionalTourTargetProps(tourTargets?.controls)}
            >
              <div
                className={cn(
                  'grid gap-3 rounded-md border bg-background p-3 md:grid-cols-3',
                  PANEL_BORDER_CLASS,
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/40 text-primary">
                    <IconBuilding className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      Entity
                    </p>
                    <p className="truncate font-semibold">
                      {selectedEntity?.shortName || 'Select entity'}
                    </p>
                  </div>
                </div>
                <div className="min-w-0 border-border md:border-l md:pl-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Period
                  </p>
                  <p className="truncate font-semibold">
                    {selectedPeriodLabel}
                  </p>
                </div>
                <div className="min-w-0 border-border md:border-l md:pl-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Selected batches
                  </p>
                  <p className="truncate font-semibold">
                    {selectedBatchIds.length.toLocaleString()} of{' '}
                    {batchOptions.length.toLocaleString()}
                  </p>
                </div>
              </div>

              <FieldGroup className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field>
                  <FieldLabel>Entity</FieldLabel>
                  <Select
                    value={payeeShortName}
                    onValueChange={(value: string | null) => {
                      setPayeeShortName(value ?? '')
                    }}
                    disabled={isLoadingOptions || entities.length === 0}
                  >
                    <SelectTrigger
                      className={cn(MERGE_SELECT_TRIGGER_CLASS, 'w-full')}
                    >
                      <SelectValue placeholder="Select entity" />
                    </SelectTrigger>
                    <SelectContent {...MERGE_SELECT_CONTENT_PROPS}>
                      <SelectGroup>
                        <SelectLabel>Entities</SelectLabel>
                        {entities.map((entity) => (
                          <SelectItem
                            key={entity.id}
                            value={entity.shortName}
                            disabled={!entity.hasValidTin}
                            className={MERGE_SELECT_ITEM_CLASS}
                          >
                            {entity.shortName}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription className="truncate text-xs">
                    {selectedEntity?.companyName ??
                      (selectedEntity?.tin
                        ? formatTinForDisplay(selectedEntity.tin) ||
                          selectedEntity.tin
                        : '-')}
                  </FieldDescription>
                </Field>

                <Field className="xl:col-span-2">
                  <FieldLabel>Period type</FieldLabel>
                  <ToggleGroup
                    value={[periodType]}
                    onValueChange={(value) => {
                      const next = value.at(0)
                      if (next === 'annual' || next === 'quarterly') {
                        setPeriodType(next)
                      }
                    }}
                    variant="outline"
                    className={MERGE_TOGGLE_GROUP_CLASS}
                  >
                    <ToggleGroupItem
                      value="quarterly"
                      className={cn(
                        MERGE_TOGGLE_ITEM_CLASS,
                        'border-r border-border/60',
                      )}
                    >
                      Quarterly
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="annual"
                      className={MERGE_TOGGLE_ITEM_CLASS}
                    >
                      Annual
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>

                <Field>
                  <FieldLabel>Year</FieldLabel>
                  <Input
                    type="number"
                    min={2000}
                    max={2100}
                    value={year}
                    className={MERGE_INPUT_CLASS}
                    onChange={(event) => setYear(event.target.value)}
                  />
                </Field>

                {periodType === 'quarterly' ? (
                  <Field>
                    <FieldLabel>Quarter</FieldLabel>
                    <Select
                      value={quarter}
                      onValueChange={(value: string | null) => {
                        setQuarter(value ?? '1')
                      }}
                    >
                      <SelectTrigger
                        className={cn(MERGE_SELECT_TRIGGER_CLASS, 'w-full')}
                      >
                        <SelectValue placeholder="Select quarter" />
                      </SelectTrigger>
                      <SelectContent {...MERGE_SELECT_CONTENT_PROPS}>
                        <SelectGroup>
                          <SelectLabel>Quarter</SelectLabel>
                          {[1, 2, 3, 4].map((value) => (
                            <SelectItem
                              key={value}
                              value={String(value)}
                              className={MERGE_SELECT_ITEM_CLASS}
                            >
                              {value}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
              </FieldGroup>

              {selectedEntity && !selectedEntity.hasValidTin ? (
                <Alert variant="destructive">
                  <IconAlertCircle />
                  <AlertTitle>Entity TIN is invalid</AlertTitle>
                  <AlertDescription>
                    The selected entity needs exactly 9 TIN digits before
                    merging.
                  </AlertDescription>
                </Alert>
              ) : null}
            </section>

            <section
              aria-label="Upload batch builder"
              className={cn(
                'flex flex-col gap-3 rounded-lg border bg-muted/10 p-3',
                PANEL_BORDER_CLASS,
              )}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">Upload batches</h3>
                    <Badge variant="outline">
                      {selectedBatchIds.length} selected
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Select closed batches with signed 2307 PDFs for{' '}
                    {selectedPeriodLabel}. Nothing is selected by default.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={selectAllBatchOptions}
                    disabled={
                      isLoadingBatchOptions ||
                      batchOptions.length === 0 ||
                      selectedBatchIds.length === batchOptions.length
                    }
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearBatchSelection}
                    disabled={selectedBatchIds.length === 0}
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    title="Refresh upload batches"
                    onClick={() => void loadBatchOptions()}
                    disabled={!canLoadBatchOptions || isLoadingBatchOptions}
                  >
                    {isLoadingBatchOptions ? (
                      <IconLoader2
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <IconRefresh data-icon="inline-start" />
                    )}
                    <span className="sr-only">Refresh upload batches</span>
                  </Button>
                </div>
              </div>

              {batchOptionsError ? (
                <Alert variant="destructive">
                  <IconAlertCircle />
                  <AlertTitle>Unable to load upload batches</AlertTitle>
                  <AlertDescription>{batchOptionsError}</AlertDescription>
                </Alert>
              ) : null}

              {!canLoadBatchOptions ? (
                <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                  Select a valid entity and period to load eligible upload
                  batches.
                </div>
              ) : null}

              {canLoadBatchOptions && isLoadingBatchOptions ? (
                <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <IconLoader2 className="size-3.5 animate-spin" />
                    Loading upload batches
                  </span>
                </div>
              ) : null}

              {canLoadBatchOptions &&
              !isLoadingBatchOptions &&
              !batchOptionsError &&
              batchOptions.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                  No closed upload batches have eligible signed PDFs for this
                  scope.
                </div>
              ) : null}

              {batchOptions.length > 0 ? (
                <div className="flex max-h-[18rem] flex-col gap-2 overflow-auto pr-1">
                  {batchOptions.map((batch) => {
                    const isSelected = selectedBatchIdSet.has(batch.id)
                    const activityDate =
                      batch.closedAt ?? batch.lastActivityAt ?? batch.createdAt

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
                            toggleBatchSelection(batch.id, checked === true)
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {batch.name ?? `Batch ${batch.id.slice(0, 8)}`}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {batch.status} · {formatDateTime(activityDate)}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {batch.eligibleSignedPdfCount.toLocaleString()} PDFs
                        </Badge>
                      </label>
                    )
                  })}
                </div>
              ) : null}
            </section>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card
            size="sm"
            className={PANEL_CARD_CLASS}
            aria-label="Package preview"
          >
            <CardHeader
              className={cn('gap-1.5 border-b', PANEL_BORDER_CLASS)}
              {...getOptionalTourTargetProps(tourTargets?.preview)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-sm">Package preview</CardTitle>
                  <CardDescription className="text-xs">
                    Review the manifest split before submitting the official
                    merge job.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="shrink-0 whitespace-nowrap">
                  3 max outputs
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {previewError ? (
                <Alert variant="destructive">
                  <IconAlertCircle />
                  <AlertTitle>Unable to preview package</AlertTitle>
                  <AlertDescription>{previewError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <MetricTile
                  icon={IconFileTypePdf}
                  label="Signed PDFs"
                  value={preview?.totalInputFiles ?? 0}
                  unit="PDFs"
                />
                <MetricTile
                  icon={IconFolder}
                  label="Total size"
                  value={formatBytes(preview?.totalSizeBytes ?? 0)}
                  unit=""
                />
                <MetricTile
                  icon={IconFileCheck}
                  label="Output files"
                  value={preview?.outputCount ?? 0}
                  unit="Files"
                />
                <MetricTile
                  icon={IconAlertCircle}
                  label="Late"
                  value={preview?.lateInputCount ?? 0}
                  unit="PDFs"
                />
              </div>

              <div className={cn('rounded-lg border', PANEL_BORDER_CLASS)}>
                <Table className="min-w-[420px] text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 w-[150px] px-2">
                        Output batch
                      </TableHead>
                      <TableHead className="h-9 w-[90px] px-2">PDFs</TableHead>
                      <TableHead className="h-9 w-[100px] px-2">Size</TableHead>
                      <TableHead className="h-9 w-[80px] px-2 text-right">
                        Part
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview ? (
                      preview.parts.map((part) => (
                        <TableRow key={part.partNumber}>
                          <TableCell className="px-2 py-2 font-medium">
                            Batch {part.partNumber}
                          </TableCell>
                          <TableCell className="px-2 py-2">
                            {part.inputCount} PDFs
                          </TableCell>
                          <TableCell className="px-2 py-2">
                            {formatBytes(part.sizeBytes)}
                          </TableCell>
                          <TableCell className="px-2 py-2 text-right">
                            {formatPartNumber(part.partNumber)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="h-20 text-center text-muted-foreground"
                        >
                          Preview the split to see output batches.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <LateCertificateTable rows={preview?.candidateRows ?? []} />
            </CardContent>
            <CardFooter
              className={cn(
                'flex flex-col gap-3 border-t 2xl:flex-row 2xl:items-end 2xl:justify-between',
                PANEL_BORDER_CLASS,
              )}
            >
              <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <IconClockHour4 className="size-3.5" />
                  Est. processing time: ~2-4 minutes
                </span>
                <span>{packageActionHint}</span>
              </div>
              <div
                className="flex w-full flex-col gap-2 sm:flex-row xl:flex-col 2xl:w-auto 2xl:flex-row"
                {...getOptionalTourTargetProps(tourTargets?.submitActions)}
              >
                <Button
                  type="button"
                  variant="outline"
                  className="justify-center whitespace-nowrap"
                  onClick={() => void previewMerge()}
                  disabled={!canPreview || isPreviewing}
                >
                  {isPreviewing ? (
                    <IconLoader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <IconListDetails data-icon="inline-start" />
                  )}
                  Preview split
                </Button>
                <Button
                  type="button"
                  className="justify-center whitespace-nowrap"
                  onClick={() => void submitMerge()}
                  disabled={!canSubmit}
                >
                  {isSubmitting ? (
                    <IconLoader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <IconUpload data-icon="inline-start" />
                  )}
                  Submit merge
                </Button>
              </div>
            </CardFooter>
          </Card>

          <Card
            size="sm"
            className={PANEL_CARD_CLASS}
            {...getOptionalTourTargetProps(tourTargets?.recentJobs)}
          >
            <CardHeader className={cn('border-b', PANEL_BORDER_CLASS)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-sm">Recent merge jobs</CardTitle>
                  <CardDescription className="text-xs">
                    Track processing status and download completed parts.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  title="Refresh recent merge jobs"
                  onClick={() => {
                    void loadJobs()
                    if (allJobsOpen) {
                      void loadAllJobs(allJobsPage)
                    }
                  }}
                  disabled={isLoadingJobs}
                >
                  {isLoadingJobs ? (
                    <IconLoader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <IconRefresh data-icon="inline-start" />
                  )}
                  <span className="sr-only">Refresh recent merge jobs</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div
                className="grid gap-2 sm:grid-cols-3"
                {...getOptionalTourTargetProps(tourTargets?.summary)}
              >
                <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                  <p className="text-xs text-muted-foreground">Jobs</p>
                  <p className="text-base font-semibold leading-tight">
                    {summary.totalJobs}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                  <p className="text-xs text-muted-foreground">Active</p>
                  <p className="text-base font-semibold leading-tight">
                    {summary.activeJobs}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                  <p className="text-xs text-muted-foreground">Ready</p>
                  <p className="text-base font-semibold leading-tight">
                    {summary.readyDownloads}
                  </p>
                </div>
              </div>
              <JobTable
                jobs={jobs}
                isLoading={isLoadingJobs}
                emptyMessage="No merge jobs yet."
                onDownload={(jobId, partNumber) => {
                  void downloadOutput(jobId, partNumber)
                }}
              />
            </CardContent>
            <CardFooter className="justify-center border-t">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setAllJobsPage(1)
                  setAllJobsOpen(true)
                }}
              >
                View all jobs
                <IconChevronRight data-icon="inline-end" />
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>

      <Sheet open={allJobsOpen} onOpenChange={setAllJobsOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="overflow-y-auto data-[side=right]:inset-y-2 data-[side=right]:right-2 data-[side=right]:h-[calc(100dvh-1rem)] data-[side=right]:w-[calc(100vw-1rem)] data-[side=right]:max-w-none data-[side=right]:rounded-lg data-[side=right]:border data-[side=right]:sm:max-w-none data-[side=right]:lg:w-[min(1500px,calc(100vw-1rem))] data-[side=right]:lg:max-w-none data-[side=right]:2xl:w-[min(1680px,calc(100vw-1rem))]"
        >
          <SheetHeader className="border-b bg-background">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <SheetTitle>All merge jobs</SheetTitle>
                <SheetDescription>
                  Review signed 2307 merge packages and download completed
                  outputs.
                </SheetDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-center"
                  onClick={() => {
                    void loadAllJobs(allJobsPage)
                  }}
                  disabled={isLoadingAllJobs}
                >
                  {isLoadingAllJobs ? (
                    <IconLoader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <IconRefresh data-icon="inline-start" />
                  )}
                  Refresh
                </Button>
                <SheetClose
                  render={<Button type="button" variant="outline" size="sm" />}
                >
                  Close
                </SheetClose>
              </div>
            </div>
          </SheetHeader>
          <div className="flex flex-col gap-4 p-4">
            {allJobsError ? (
              <Alert variant="destructive">
                <IconAlertCircle />
                <AlertTitle>Unable to load job history</AlertTitle>
                <AlertDescription>{allJobsError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <HistorySummaryTile
                label="Total"
                value={summary.totalJobs}
                helper="merge jobs"
              />
              <HistorySummaryTile
                label="Running"
                value={summary.activeJobs}
                helper="active jobs"
              />
              <HistorySummaryTile
                label="Ready"
                value={summary.readyDownloads}
                helper="downloadable parts"
              />
              <HistorySummaryTile
                label="Failed"
                value={allJobsFailedOnPage}
                helper="loaded page"
              />
            </div>

            <div className="rounded-lg border border-border/60 bg-background p-3">
              <FieldGroup className="grid gap-3 lg:grid-cols-[minmax(220px,1.2fr)_minmax(300px,1.35fr)_160px_180px_auto] lg:items-end">
                <Field>
                  <FieldLabel>Search</FieldLabel>
                  <div className="relative">
                    <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      aria-label="Search merge jobs"
                      value={allJobsQuery}
                      placeholder="Entity, TIN, job ID"
                      className={cn(MERGE_INPUT_CLASS, 'pl-8')}
                      onChange={(event) => {
                        setAllJobsQuery(event.target.value)
                      }}
                    />
                  </div>
                </Field>

                <Field>
                  <FieldLabel>Status</FieldLabel>
                  <ToggleGroup
                    value={[allJobsStatusFilter]}
                    onValueChange={(value) => {
                      const next = value.at(0)
                      if (
                        next === 'all' ||
                        next === 'active' ||
                        next === 'ready' ||
                        next === 'failed'
                      ) {
                        setAllJobsStatusFilter(next)
                      }
                    }}
                    variant="outline"
                    className="grid h-8 w-full grid-cols-4 overflow-hidden rounded-md border border-border/70 bg-background data-[spacing=0]:data-[variant=outline]:rounded-md"
                  >
                    {ALL_JOBS_STATUS_FILTERS.map((filter) => (
                      <ToggleGroupItem
                        key={filter.value}
                        value={filter.value}
                        className={cn(
                          MERGE_TOGGLE_ITEM_CLASS,
                          filter.value !== 'failed'
                            ? 'border-r border-border/60'
                            : '',
                        )}
                      >
                        {filter.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>

                <Field>
                  <FieldLabel>Period</FieldLabel>
                  <Select
                    value={allJobsPeriodFilter}
                    onValueChange={(value: string | null) => {
                      if (
                        value === 'all' ||
                        value === 'annual' ||
                        value === 'quarterly'
                      ) {
                        setAllJobsPeriodFilter(value)
                      }
                    }}
                  >
                    <SelectTrigger
                      className={cn(MERGE_SELECT_TRIGGER_CLASS, 'w-full')}
                    >
                      <SelectValue placeholder="All periods" />
                    </SelectTrigger>
                    <SelectContent {...MERGE_SELECT_CONTENT_PROPS}>
                      <SelectGroup>
                        <SelectLabel>Period</SelectLabel>
                        <SelectItem
                          value="all"
                          className={MERGE_SELECT_ITEM_CLASS}
                        >
                          All periods
                        </SelectItem>
                        <SelectItem
                          value="annual"
                          className={MERGE_SELECT_ITEM_CLASS}
                        >
                          Annual
                        </SelectItem>
                        <SelectItem
                          value="quarterly"
                          className={MERGE_SELECT_ITEM_CLASS}
                        >
                          Quarterly
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>Sort</FieldLabel>
                  <Select
                    value={allJobsSort}
                    onValueChange={(value: string | null) => {
                      if (
                        value === 'updated-desc' ||
                        value === 'created-desc' ||
                        value === 'entity-asc'
                      ) {
                        setAllJobsSort(value)
                      }
                    }}
                  >
                    <SelectTrigger
                      className={cn(MERGE_SELECT_TRIGGER_CLASS, 'w-full')}
                    >
                      <SelectValue placeholder="Sort jobs" />
                    </SelectTrigger>
                    <SelectContent {...MERGE_SELECT_CONTENT_PROPS}>
                      <SelectGroup>
                        <SelectLabel>Sort jobs</SelectLabel>
                        <SelectItem
                          value="updated-desc"
                          className={MERGE_SELECT_ITEM_CLASS}
                        >
                          Updated newest
                        </SelectItem>
                        <SelectItem
                          value="created-desc"
                          className={MERGE_SELECT_ITEM_CLASS}
                        >
                          Created newest
                        </SelectItem>
                        <SelectItem
                          value="entity-asc"
                          className={MERGE_SELECT_ITEM_CLASS}
                        >
                          Entity A-Z
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-center"
                  disabled={!hasAllJobsFilters}
                  onClick={() => {
                    setAllJobsQuery('')
                    setAllJobsStatusFilter('all')
                    setAllJobsPeriodFilter('all')
                  }}
                >
                  <IconX data-icon="inline-start" />
                  Clear
                </Button>
              </FieldGroup>
            </div>

            <AllMergeJobsTable
              jobs={filteredAllJobs}
              isLoading={isLoadingAllJobs}
              emptyMessage="No merge jobs match this history view."
              expandedJobId={expandedAllJobsJobId}
              onExpandedJobChange={setExpandedAllJobsJobId}
              onDownload={(jobId, partNumber) => {
                void downloadOutput(jobId, partNumber)
              }}
            />
          </div>
          <SheetFooter className="border-t bg-background">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {allJobsShowingStart.toLocaleString()}-
                {allJobsShowingEnd.toLocaleString()} of{' '}
                {allJobsTotalItems.toLocaleString()}
                {hasAllJobsFilters
                  ? ` · ${filteredAllJobs.length.toLocaleString()} match filters on this page`
                  : ''}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    isLoadingAllJobs ||
                    !(allJobsPagination?.hasPreviousPage ?? false)
                  }
                  onClick={() => {
                    setAllJobsPage((current) => Math.max(1, current - 1))
                  }}
                >
                  <IconChevronLeft data-icon="inline-start" />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    isLoadingAllJobs ||
                    !(allJobsPagination?.hasNextPage ?? false)
                  }
                  onClick={() => {
                    setAllJobsPage((current) => current + 1)
                  }}
                >
                  Next
                  <IconChevronRight data-icon="inline-end" />
                </Button>
              </div>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
