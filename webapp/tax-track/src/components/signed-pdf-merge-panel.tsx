import {
  IconAlertCircle,
  IconBuilding,
  IconCheck,
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
  IconStack2,
  IconUpload,
} from '@tabler/icons-react'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Icon } from '@tabler/icons-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  FieldError,
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

const CURRENT_YEAR = new Date().getFullYear()
const ACTIVE_JOB_STATUSES = new Set(['pending', 'submitted', 'running'])
const ALL_JOBS_PAGE_SIZE = 25
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

const readJson = async <T,>(response: Response): Promise<T | null> =>
  (await response.json().catch(() => null)) as T | null

const getOptionalTourTargetProps = (targetId?: string) =>
  targetId ? getProductTourTargetProps(targetId) : {}

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
        'flex items-center gap-2 rounded-lg border bg-muted/20 p-3',
        PANEL_BORDER_CLASS,
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-primary">
        <IconComponent className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-base font-semibold">
          {value} <span className="text-xs font-normal">{unit}</span>
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
      <div
        className={cn('overflow-hidden rounded-lg border', PANEL_BORDER_CLASS)}
      >
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 px-2">Certificate</TableHead>
              <TableHead className="h-9 px-2">Certificate period</TableHead>
              <TableHead className="h-9 px-2">Merge package</TableHead>
              <TableHead className="h-9 px-2">Status</TableHead>
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
                    <span className="text-muted-foreground">
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
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>(1)
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [isLoadingJobs, setIsLoadingJobs] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [allJobsOpen, setAllJobsOpen] = useState(false)
  const [allJobs, setAllJobs] = useState<Array<MergeJob>>([])
  const [allJobsPagination, setAllJobsPagination] =
    useState<MergePagination | null>(null)
  const [allJobsPage, setAllJobsPage] = useState(1)
  const [isLoadingAllJobs, setIsLoadingAllJobs] = useState(false)
  const [allJobsError, setAllJobsError] = useState('')

  const selectedEntity = useMemo(
    () => entities.find((entity) => entity.shortName === payeeShortName),
    [entities, payeeShortName],
  )

  const requestPayload = useMemo(() => {
    const parsedYear = Number.parseInt(year, 10)
    const parsedQuarter = Number.parseInt(quarter, 10)

    return {
      payeeShortName,
      periodType,
      year: parsedYear,
      ...(periodType === 'quarterly' ? { quarter: parsedQuarter } : {}),
    }
  }, [payeeShortName, periodType, year, quarter])

  const hasActiveJobs =
    summary.activeJobs > 0 ||
    jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))
  const selectedPeriodLabel =
    periodType === 'annual' ? `TY ${year || '-'}` : `${quarter}Q ${year || '-'}`
  const canPreview =
    canExportPdf &&
    Boolean(payeeShortName) &&
    Number.isInteger(requestPayload.year) &&
    selectedEntity?.hasValidTin === true
  const canSubmit = Boolean(preview) && canPreview && !isSubmitting

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

  useEffect(() => {
    void loadOptions()
    void loadJobs()
  }, [loadJobs, loadOptions])

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
      toast.error(
        error instanceof Error ? error.message : 'Unable to submit merge job.',
      )
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
      <div
        className="grid gap-2 md:grid-cols-3"
        {...getOptionalTourTargetProps(tourTargets?.summary)}
      >
        <SummaryTile
          icon={IconStack2}
          label="Jobs"
          value={summary.totalJobs}
          description="Total merge jobs"
        />
        <SummaryTile
          icon={IconClockHour4}
          label="Active"
          value={summary.activeJobs}
          description="Processing now"
        />
        <SummaryTile
          icon={IconDownload}
          label="Ready downloads"
          value={summary.readyDownloads}
          description="Batches ready"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(480px,0.9fr)_minmax(560px,1.1fr)]">
        <Card size="sm" className={PANEL_CARD_CLASS}>
          <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
            <CardTitle className="text-sm">Signed 2307 PDF merge</CardTitle>
            <CardDescription className="text-xs">
              Select an entity and period, preview the split, then submit the
              merge job.
            </CardDescription>
            <div {...getOptionalTourTargetProps(tourTargets?.workflow)}>
              <WorkflowSteps currentStep={workflowStep} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div
              className={cn(
                'grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-3',
                PANEL_BORDER_CLASS,
              )}
            >
              <div className="flex items-center gap-2">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-primary">
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
                <p className="truncate font-semibold">{selectedPeriodLabel}</p>
              </div>
              <div className="min-w-0 border-border md:border-l md:pl-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Ready downloads
                </p>
                <p className="truncate font-semibold">
                  {summary.readyDownloads}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Select an entity and period to preview how signed 2307 PDFs will
              be split into EAFS-ready batches.
            </p>

            <FieldGroup
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
              {...getOptionalTourTargetProps(tourTargets?.controls)}
            >
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
                  The selected entity needs exactly 9 TIN digits before merging.
                </AlertDescription>
              </Alert>
            ) : null}

            {previewError ? (
              <FieldError className="rounded-xl border border-destructive/30 bg-destructive/10 p-3">
                {previewError}
              </FieldError>
            ) : null}

            <div
              className="flex flex-col gap-3"
              {...getOptionalTourTargetProps(tourTargets?.preview)}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Preview batch split</h3>
                <Badge variant="outline">3 max outputs</Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
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

              <div
                className={cn(
                  'overflow-hidden rounded-lg border',
                  PANEL_BORDER_CLASS,
                )}
              >
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 px-2">Output batch</TableHead>
                      <TableHead className="h-9 px-2">PDFs</TableHead>
                      <TableHead className="h-9 px-2">Size</TableHead>
                      <TableHead className="h-9 px-2 text-right">
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
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2 border-t sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <IconClockHour4 className="size-3.5" />
              <span>Est. processing time: ~2-4 minutes</span>
            </div>
            <div
              className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"
              {...getOptionalTourTargetProps(tourTargets?.submitActions)}
            >
              <Button
                type="button"
                variant="outline"
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

      <Sheet open={allJobsOpen} onOpenChange={setAllJobsOpen}>
        <SheetContent
          side="right"
          className="w-screen overflow-y-auto sm:max-w-[calc(100vw-1.5rem)] lg:w-[min(1180px,calc(100vw-2rem))] lg:max-w-none"
        >
          <SheetHeader className="border-b">
            <SheetTitle>All merge jobs</SheetTitle>
            <SheetDescription>
              Review every signed 2307 merge job and download ready outputs.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-3 p-4">
            {allJobsError ? (
              <Alert variant="destructive">
                <IconAlertCircle />
                <AlertTitle>Unable to load job history</AlertTitle>
                <AlertDescription>{allJobsError}</AlertDescription>
              </Alert>
            ) : null}
            <JobTable
              jobs={allJobs}
              isLoading={isLoadingAllJobs}
              emptyMessage="No merge jobs match this history view."
              allowHorizontalScroll={false}
              onDownload={(jobId, partNumber) => {
                void downloadOutput(jobId, partNumber)
              }}
            />
          </div>
          <SheetFooter className="border-t">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Page {allJobsPagination?.page ?? allJobsPage} of{' '}
                {allJobsPagination?.totalPages ?? 1}
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
