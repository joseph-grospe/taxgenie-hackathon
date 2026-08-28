import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconCheck,
  IconChecks,
  IconChevronLeft,
  IconChevronRight,
  IconFilePlus,
  IconFileTypePdf,
  IconFolderOpen,
  IconHelpCircle,
  IconListDetails,
  IconLoader2,
  IconScanEye,
  IconSearch,
  IconShieldCheck,
  IconStack2,
  IconTimeline,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { formatTinForDisplay } from '@taxgenie/shared/utils/tin'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ChangeEvent, ReactNode, RefObject } from 'react'

import type { JobsStatusFilter, JobsTab } from '@/lib/upload-intake-view-model'
import type {
  BatchFilesResponse,
  IntakeBatchView,
  IntakeUploadView,
  LocalUploadItem,
  SkippedUploadFile,
  StatusSummary,
  UploadEntityOption,
} from '@/lib/upload-intake-types'
import {
  buildActiveBatchSummaryItems,
  buildBatchStatusTimeline,
  buildJobsModel,
  buildNeedsAttentionItems,
  buildQueueMetrics,
  getActiveBatchFilePresentation,
  getLocalUploadProgressValue,
  getUploadProgressValue,
} from '@/lib/upload-intake-view-model'
import { defaultBatchSearch } from '@/lib/batch-search-state'
import { defaultBatchDetailSearch } from '@/lib/batch-file-search-state'
import { createManilaDateFormatter } from '@/lib/manila-time'
import { ATTENTION_PREVIEW_PAGE_SIZE } from '@/lib/upload-intake-constants'
import { RefreshStatus } from '@/components/refresh-status'
import { StatusPill } from '@/components/status-pill'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  buildLocalSelectionSummary,
  canRemoveLocalSelectedFile,
  getPendingLocalUploadCount,
} from '@/lib/upload-intake-client'
import { MAX_INTAKE_UPLOAD_FILE_SIZE_LABEL } from '@/lib/intake-utils'
import {
  UPLOAD_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { cn } from '@/lib/utils'

type UploadIntakePageProps = {
  inputRef: RefObject<HTMLInputElement | null>
  activeBatch: IntakeBatchView | null
  recentBatches: Array<IntakeBatchView>
  uploads: Array<IntakeUploadView>
  uploadEntities: Array<UploadEntityOption>
  selectedEntityId: number | null
  localFiles: Array<LocalUploadItem>
  isRefreshing: boolean
  isAutoRefreshing: boolean
  lastRefreshedLabel: string
  isLoadingEntities: boolean
  isStartingUpload: boolean
  isClosingBatch: boolean
  loadError: string | null
  selectionWarning: string | null
  selectionSkippedFiles: Array<SkippedUploadFile>
  selectionSkippedCount: number
  statusSheetTourRequest?: {
    id: number
    open: boolean
    tab?: BatchStatusTab
  } | null
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void
  onEntityChange: (entityId: number | null) => void
  onSelectFiles: () => void
  onStartUpload: () => void
  onCloseBatch: () => void
  onOpenDestination: (documentId: string | null | undefined) => void
  onOpenBatch: (batchId: string | null | undefined) => void
  onRemoveSelectedFile: (clientId: string) => void
  onDismissSelectionWarning: () => void
  onRefresh: () => void
}

type BatchFileRow = {
  id: string
  uploadId: string | null
  fileName: string
  sizeBytes: number
  statusLabel: string
  progress: number
  detail: string
  error: string | null
  isPendingSelection: boolean
  canRemoveSelected: boolean
}

type ActiveBatchFileTab =
  | 'all'
  | 'waiting'
  | 'processing'
  | 'review'
  | 'error'
  | 'duplicate'
  | 'completed'

type BatchStatusTab = 'summary' | 'issues' | 'rules'

const STATUS_FILTER_OPTIONS: Array<{
  value: JobsStatusFilter
  label: string
}> = [
  { value: 'all', label: 'All statuses' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'review', label: 'Review' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'error', label: 'Error' },
]

const DATE_TIME_FORMATTER = createManilaDateFormatter('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
const ACTIVE_BATCH_PREVIEW_INITIAL_LIMIT = 12
const ACTIVE_BATCH_PREVIEW_INCREMENT = 12
const ACTIVE_BATCH_PREVIEW_MAX = 48
const JOBS_TABLE_PREVIEW_LIMIT = 25
const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'
const PANEL_BORDER_CLASS = 'border-border/60'
const BATCH_PREVIEW_GRID_CLASS =
  'grid max-h-[22rem] grid-cols-1 gap-1.5 overflow-y-auto overscroll-contain pr-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
const REVIEW_SHEET_CONTENT_CLASS =
  'w-full overflow-y-auto sm:w-1/2 sm:max-w-none'
const STATUS_SHEET_CONTENT_CLASS =
  'w-full overflow-y-auto sm:max-w-2xl lg:max-w-3xl'

function InlineHelp({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={label}
          />
        }
      >
        <IconHelpCircle />
      </TooltipTrigger>
      <TooltipContent align="start" className="max-w-64">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

const getUploadRules = () => [
  {
    title: 'Multiple PDFs per batch',
    detail: 'Build one intake batch and add several PDFs into it over time.',
    icon: <IconStack2 />,
  },
  {
    title: 'One open batch per user',
    detail:
      'Returning to /upload resumes your current open batch automatically.',
    icon: <IconFolderOpen />,
  },
  {
    title: 'Files process independently',
    detail:
      'Each PDF uploads, queues, and completes without blocking the rest.',
    icon: <IconTimeline />,
  },
  {
    title: `${MAX_INTAKE_UPLOAD_FILE_SIZE_LABEL} file limit`,
    detail: `Each BIR 2307 PDF must be ${MAX_INTAKE_UPLOAD_FILE_SIZE_LABEL} or smaller.`,
    icon: <IconShieldCheck />,
  },
]

const formatBytes = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return '—'
  }

  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) {
    return '—'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return DATE_TIME_FORMATTER.format(parsed)
}

const getBatchDisplayName = (batch: IntakeBatchView) => batch.name ?? batch.id

const emptyStatusSummary = (): StatusSummary => ({
  pending: 0,
  uploaded: 0,
  queued: 0,
  processing: 0,
  success: 0,
  review: 0,
  duplicate: 0,
  error: 0,
})

const buildActiveStatusSummary = (
  uploads: Array<IntakeUploadView>,
): StatusSummary => {
  const summary = emptyStatusSummary()

  for (const upload of uploads) {
    switch (upload.overallStatus) {
      case 'manual_review':
        summary.review += 1
        break
      case 'duplicate':
      case 'error':
        summary[upload.overallStatus] += 1
        break
      case 'pending':
      case 'uploaded':
      case 'queued':
      case 'processing':
      case 'success':
        summary[upload.overallStatus] += 1
        break
      default:
        break
    }
  }

  return summary
}

const buildBatchFileRows = (
  activeBatch: IntakeBatchView | null,
  localFiles: Array<LocalUploadItem>,
): Array<BatchFileRow> => {
  const serverRows =
    activeBatch?.files.map<BatchFileRow>((file) => {
      const presentation = getActiveBatchFilePresentation(file)

      return {
        id: file.id,
        uploadId: file.id,
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
        statusLabel: presentation.statusLabel,
        progress: getUploadProgressValue(file),
        detail: presentation.detail,
        error: file.errorMessage,
        isPendingSelection: false,
        canRemoveSelected: false,
      }
    }) ?? []

  const serverUploadIds = new Set(
    serverRows
      .map((row) => row.uploadId)
      .filter((uploadId): uploadId is string => Boolean(uploadId)),
  )

  const localRows = localFiles
    .filter((file) => !file.uploadId || !serverUploadIds.has(file.uploadId))
    .map<BatchFileRow>((file) => ({
      id: file.clientId,
      uploadId: file.uploadId,
      fileName: file.file.name,
      sizeBytes: file.file.size,
      statusLabel: file.status,
      progress: getLocalUploadProgressValue(file),
      detail:
        file.status === 'Pending'
          ? 'Waiting to be uploaded into the current batch.'
          : file.status === 'Requesting'
            ? 'Preparing signed upload URL.'
            : file.status === 'Uploading'
              ? 'Uploading file directly to source storage.'
              : file.status === 'Queueing'
                ? 'Validating the uploaded object and queueing processing.'
                : file.status === 'Error'
                  ? 'Upload needs attention before it can continue.'
                  : 'Upload finished.',
      error: file.error,
      isPendingSelection: true,
      canRemoveSelected: canRemoveLocalSelectedFile(file),
    }))

  return [...localRows, ...serverRows]
}

const getActiveBatchFileTab = (row: BatchFileRow): ActiveBatchFileTab => {
  if (row.statusLabel === 'Review') {
    return 'review'
  }

  if (row.statusLabel === 'Duplicate') {
    return 'duplicate'
  }

  if (row.statusLabel === 'Error') {
    return 'error'
  }

  if (['Done', 'Completed'].includes(row.statusLabel)) {
    return 'completed'
  }

  if (
    [
      'Requesting',
      'Uploading',
      'Queueing',
      'Queued',
      'Uploaded',
      'Processing',
    ].includes(row.statusLabel)
  ) {
    return 'processing'
  }

  return 'waiting'
}

const buildActiveBatchFileCounts = (rows: Array<BatchFileRow>) =>
  rows.reduce<Record<ActiveBatchFileTab, number>>(
    (counts, row) => {
      counts.all += 1
      counts[getActiveBatchFileTab(row)] += 1
      return counts
    },
    {
      all: 0,
      waiting: 0,
      processing: 0,
      review: 0,
      error: 0,
      duplicate: 0,
      completed: 0,
    },
  )

const getActiveFileSearch = (tab: ActiveBatchFileTab) => {
  switch (tab) {
    case 'waiting':
      return {
        ...defaultBatchDetailSearch,
        tab: 'files' as const,
        status: 'pending' as const,
      }
    case 'processing':
      return {
        ...defaultBatchDetailSearch,
        tab: 'files' as const,
        status: 'processing' as const,
      }
    case 'error':
      return {
        ...defaultBatchDetailSearch,
        tab: 'files' as const,
        status: 'error' as const,
      }
    case 'review':
      return {
        ...defaultBatchDetailSearch,
        tab: 'files' as const,
        status: 'manual_review' as const,
      }
    case 'duplicate':
      return {
        ...defaultBatchDetailSearch,
        tab: 'files' as const,
        status: 'duplicate' as const,
      }
    case 'completed':
      return {
        ...defaultBatchDetailSearch,
        tab: 'files' as const,
        status: 'success' as const,
      }
    default:
      return { ...defaultBatchDetailSearch, tab: 'files' as const }
  }
}

export function UploadIntakePage({
  inputRef,
  activeBatch,
  recentBatches,
  uploads,
  uploadEntities,
  selectedEntityId,
  localFiles,
  isRefreshing,
  isAutoRefreshing,
  lastRefreshedLabel,
  isLoadingEntities,
  isStartingUpload,
  isClosingBatch,
  loadError,
  selectionWarning,
  selectionSkippedFiles,
  selectionSkippedCount,
  statusSheetTourRequest,
  onFilesSelected,
  onEntityChange,
  onSelectFiles,
  onStartUpload,
  onCloseBatch,
  onOpenDestination,
  onOpenBatch,
  onRemoveSelectedFile,
  onDismissSelectionWarning,
  onRefresh,
}: UploadIntakePageProps) {
  const [jobsTab, setJobsTab] = useState<JobsTab>('all')
  const [jobsSearch, setJobsSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<JobsStatusFilter>('all')
  const [statusSheetOpen, setStatusSheetOpen] = useState(false)
  const [statusSheetTab, setStatusSheetTab] =
    useState<BatchStatusTab>('summary')
  const [attentionUploads, setAttentionUploads] = useState<
    Array<IntakeUploadView>
  >([])
  const [attentionError, setAttentionError] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(jobsSearch)

  const activeSummary = useMemo(
    () => activeBatch?.counts ?? buildActiveStatusSummary(uploads),
    [activeBatch?.counts, uploads],
  )
  const queueMetrics = useMemo(
    () =>
      buildQueueMetrics(
        activeSummary,
        uploads,
        activeBatch?.openAttentionCount,
      ),
    [activeBatch?.openAttentionCount, activeSummary, uploads],
  )
  const needsAttentionItems = useMemo(
    () => buildNeedsAttentionItems(attentionUploads),
    [attentionUploads],
  )
  const jobsModel = useMemo(
    () =>
      buildJobsModel({
        uploads,
        activeTab: jobsTab,
        statusFilter,
        searchQuery: deferredSearch,
      }),
    [deferredSearch, jobsTab, uploads, statusFilter],
  )
  const batchRows = useMemo(
    () => buildBatchFileRows(activeBatch, localFiles),
    [activeBatch, localFiles],
  )
  const pendingSelections = getPendingLocalUploadCount(localFiles)
  const hasBlockingLocalWork = localFiles.some((file) =>
    ['Pending', 'Requesting', 'Uploading', 'Queueing'].includes(file.status),
  )
  const legacyBatchBlocksUpload =
    Boolean(activeBatch) &&
    !activeBatch?.entity &&
    (activeBatch?.totalFiles ?? 0) > 0
  const hasEntityContext =
    Boolean(activeBatch?.entity) || selectedEntityId !== null
  const canSelectFiles = hasEntityContext && !legacyBatchBlocksUpload
  const canStartUpload = canSelectFiles && pendingSelections > 0
  const openStatusSheet = useCallback((tab: BatchStatusTab = 'summary') => {
    setStatusSheetTab(tab)
    setStatusSheetOpen(true)
  }, [])

  useEffect(() => {
    if (!statusSheetTourRequest) {
      return
    }

    if (statusSheetTourRequest.open) {
      openStatusSheet(statusSheetTourRequest.tab ?? 'summary')
      return
    }

    setStatusSheetOpen(false)
  }, [
    openStatusSheet,
    statusSheetTourRequest?.id,
    statusSheetTourRequest?.open,
    statusSheetTourRequest?.tab,
  ])

  useEffect(() => {
    if (!activeBatch?.id || activeBatch.openAttentionCount === 0) {
      setAttentionUploads([])
      setAttentionError(null)
      return
    }

    let isCurrent = true
    const loadAttentionPreview = async () => {
      try {
        const params = new URLSearchParams({
          attention: 'open',
          page: '1',
          pageSize: String(ATTENTION_PREVIEW_PAGE_SIZE),
        })
        const response = await fetch(
          `/api/uploads/batches/${encodeURIComponent(activeBatch.id)}/files?${params}`,
          { cache: 'no-store' },
        )
        const payload = (await response.json().catch(() => null)) as
          | (BatchFilesResponse & { error?: string })
          | null

        if (!response.ok) {
          throw new Error(
            payload?.error ||
              `Failed to load attention preview (${response.status}).`,
          )
        }

        if (isCurrent) {
          setAttentionUploads(
            Array.isArray(payload?.files) ? payload.files : [],
          )
          setAttentionError(null)
        }
      } catch (error) {
        if (isCurrent) {
          setAttentionUploads([])
          setAttentionError(
            error instanceof Error
              ? error.message
              : 'Unable to load attention preview.',
          )
        }
      }
    }

    void loadAttentionPreview()

    return () => {
      isCurrent = false
    }
  }, [activeBatch?.id, activeBatch?.openAttentionCount])

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={onFilesSelected}
      />

      {loadError ? (
        <Alert variant="destructive" className="rounded-lg">
          <IconAlertTriangle />
          <AlertTitle>Unable to load upload intake</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <ActiveBatchCard
        activeBatch={activeBatch}
        canSelectFiles={canSelectFiles}
        entities={uploadEntities}
        hasBlockingLocalWork={hasBlockingLocalWork}
        isLoadingEntities={isLoadingEntities}
        isRefreshing={isRefreshing}
        isAutoRefreshing={isAutoRefreshing}
        lastRefreshedLabel={lastRefreshedLabel}
        isStartingUpload={isStartingUpload}
        isClosingBatch={isClosingBatch}
        legacyBatchBlocksUpload={legacyBatchBlocksUpload}
        localFiles={localFiles}
        pendingSelections={pendingSelections}
        rows={batchRows}
        selectedEntityId={selectedEntityId}
        selectionSkippedFiles={selectionSkippedFiles}
        selectionSkippedCount={selectionSkippedCount}
        selectionWarning={selectionWarning}
        onCloseBatch={onCloseBatch}
        onDismissSelectionWarning={onDismissSelectionWarning}
        onEntityChange={onEntityChange}
        onOpenBatch={onOpenBatch}
        onOpenDestination={onOpenDestination}
        onOpenRules={() => openStatusSheet('rules')}
        onOpenStatusSheet={() => openStatusSheet('summary')}
        onRefresh={onRefresh}
        onRemoveSelectedFile={onRemoveSelectedFile}
        onSelectFiles={onSelectFiles}
        onStartUpload={onStartUpload}
      />

      <JobsTable
        activeBatch={activeBatch}
        jobsTab={jobsTab}
        jobsSearch={jobsSearch}
        jobsModel={jobsModel}
        isRefreshing={isRefreshing}
        isAutoRefreshing={isAutoRefreshing}
        lastRefreshedLabel={lastRefreshedLabel}
        statusFilter={statusFilter}
        onJobsSearchChange={setJobsSearch}
        onJobsTabChange={setJobsTab}
        onOpenDestination={onOpenDestination}
        onRefresh={onRefresh}
        onStatusFilterChange={setStatusFilter}
      />

      <RecentBatchesCard
        activeBatch={activeBatch}
        recentBatches={recentBatches}
        onOpenBatch={onOpenBatch}
      />

      {activeBatch ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Active batch `{activeBatch.id}` stays open until you close it. Files
          upload and process independently, so one failed upload will not block
          the rest of the batch.
        </p>
      ) : hasBlockingLocalWork ? (
        <p className="text-xs leading-5 text-muted-foreground">
          The batch will be created automatically when you start uploading the
          selected files.
        </p>
      ) : null}

      <SelectedUploadTray
        canSelectFiles={canSelectFiles}
        canStartUpload={canStartUpload}
        isStartingUpload={isStartingUpload}
        localFiles={localFiles}
        pendingSelections={pendingSelections}
        onSelectFiles={onSelectFiles}
        onStartUpload={onStartUpload}
      />

      <BatchStatusSheet
        activeBatch={activeBatch}
        attentionError={attentionError}
        items={needsAttentionItems}
        metrics={queueMetrics}
        open={statusSheetOpen}
        recentBatches={recentBatches}
        tab={statusSheetTab}
        totalAttentionCount={
          activeBatch?.openAttentionCount ?? needsAttentionItems.length
        }
        onOpenBatch={onOpenBatch}
        onOpenChange={setStatusSheetOpen}
        onOpenDestination={onOpenDestination}
        onTabChange={setStatusSheetTab}
      />
    </div>
  )
}

const getEntityName = (entity: {
  shortName: string | null
  companyName: string | null
  tin: string | null
}) => entity.shortName || entity.companyName || entity.tin

const getEntitySelectLabel = (entity: {
  shortName: string | null
  companyName: string | null
  tin: string | null
}) => {
  const shortName = entity.shortName?.trim()
  const companyName = entity.companyName?.trim()

  if (shortName && companyName) {
    return `${shortName} - ${companyName}`
  }

  return getEntityName(entity)
}

function BatchEntitySetup({
  activeBatch,
  entities,
  selectedEntityId,
  isLoading,
  legacyBatchBlocksUpload,
  onEntityChange,
}: {
  activeBatch: IntakeBatchView | null
  entities: Array<UploadEntityOption>
  selectedEntityId: number | null
  isLoading: boolean
  legacyBatchBlocksUpload: boolean
  onEntityChange: (entityId: number | null) => void
}) {
  const batchEntity = activeBatch?.entity ?? null
  const selectedEntity =
    selectedEntityId === null
      ? null
      : (entities.find((entity) => entity.id === selectedEntityId) ?? null)
  const lockedToBatch = Boolean(batchEntity)
  const selectedValue = lockedToBatch
    ? 'batch-entity'
    : selectedEntityId === null
      ? ''
      : String(selectedEntityId)
  const selectedEntityLabel =
    lockedToBatch && batchEntity
      ? getEntitySelectLabel(batchEntity)
      : selectedEntity
        ? getEntitySelectLabel(selectedEntity)
        : null
  const entityTin = batchEntity?.tin ?? selectedEntity?.tin ?? null
  const description = legacyBatchBlocksUpload
    ? 'Close the current legacy batch before starting an entity-based upload batch.'
    : lockedToBatch && batchEntity
      ? 'All PDFs in this batch must match the selected entity TIN.'
      : selectedEntity
        ? 'This entity will be locked to the batch when uploads start.'
        : 'Select the taxpayer/entity these PDFs belong to.'

  if (lockedToBatch && batchEntity) {
    return (
      <div
        {...getProductTourTargetProps(UPLOAD_TOUR_TARGETS.entity)}
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-lg border bg-muted/10 px-3 py-2 text-xs',
          PANEL_BORDER_CLASS,
        )}
      >
        <span className="font-medium text-muted-foreground">Entity</span>
        <InlineHelp label="Entity upload help">
          All PDFs in an open batch must belong to this entity. Start a new
          batch when the taxpayer changes.
        </InlineHelp>
        <Badge variant="outline">{getEntityName(batchEntity)}</Badge>
        {entityTin ? (
          <Badge variant="outline" className="font-mono">
            {formatTinForDisplay(entityTin) || entityTin}
          </Badge>
        ) : null}
      </div>
    )
  }

  return (
    <div
      {...getProductTourTargetProps(UPLOAD_TOUR_TARGETS.entity)}
      className={cn(
        'rounded-lg border bg-muted/10 px-3 py-3',
        PANEL_BORDER_CLASS,
      )}
    >
      <FieldGroup>
        <Field
          className="gap-3"
          data-disabled={
            isLoading || lockedToBatch || legacyBatchBlocksUpload
              ? true
              : undefined
          }
        >
          <div className="flex flex-col gap-2">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <FieldLabel htmlFor="upload-entity">Entity</FieldLabel>
                  <InlineHelp label="Entity upload help">
                    Choose the taxpayer before selecting PDFs. This keeps the
                    batch, storage path, and validation context aligned.
                  </InlineHelp>
                </div>
                <FieldDescription className="text-xs">
                  {description}
                </FieldDescription>
              </div>
              {!lockedToBatch ? (
                <Select
                  value={selectedValue}
                  onValueChange={(value: string | null) => {
                    onEntityChange(value ? Number(value) : null)
                  }}
                  disabled={isLoading || legacyBatchBlocksUpload}
                >
                  <SelectTrigger id="upload-entity" className="w-full">
                    <SelectValue
                      placeholder={
                        isLoading ? 'Loading entities...' : 'Select entity'
                      }
                    >
                      {selectedEntityLabel ?? undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      <SelectLabel>Entities</SelectLabel>
                      {entities.map((entity) => (
                        <SelectItem key={entity.id} value={String(entity.id)}>
                          {getEntitySelectLabel(entity)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : null}
              {selectedEntityLabel ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {lockedToBatch && batchEntity
                      ? getEntityName(batchEntity)
                      : selectedEntity
                        ? getEntityName(selectedEntity)
                        : selectedEntityLabel}
                  </Badge>
                  {entityTin ? (
                    <Badge variant="outline" className="font-mono">
                      {formatTinForDisplay(entityTin) || entityTin}
                    </Badge>
                  ) : null}
                  {lockedToBatch ? (
                    <Badge variant="outline">Locked for this batch</Badge>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </Field>
      </FieldGroup>
    </div>
  )
}

function ActiveBatchCard({
  activeBatch,
  canSelectFiles,
  entities,
  hasBlockingLocalWork,
  isLoadingEntities,
  isRefreshing,
  isAutoRefreshing,
  lastRefreshedLabel,
  rows,
  pendingSelections,
  isStartingUpload,
  isClosingBatch,
  legacyBatchBlocksUpload,
  localFiles,
  selectedEntityId,
  selectionSkippedFiles,
  selectionSkippedCount,
  selectionWarning,
  onSelectFiles,
  onStartUpload,
  onCloseBatch,
  onDismissSelectionWarning,
  onEntityChange,
  onOpenBatch,
  onOpenDestination,
  onOpenRules,
  onOpenStatusSheet,
  onRefresh,
  onRemoveSelectedFile,
}: {
  activeBatch: IntakeBatchView | null
  canSelectFiles: boolean
  entities: Array<UploadEntityOption>
  hasBlockingLocalWork: boolean
  isLoadingEntities: boolean
  isRefreshing: boolean
  isAutoRefreshing: boolean
  lastRefreshedLabel: string
  rows: Array<BatchFileRow>
  pendingSelections: number
  isStartingUpload: boolean
  isClosingBatch: boolean
  legacyBatchBlocksUpload: boolean
  localFiles: Array<LocalUploadItem>
  selectedEntityId: number | null
  selectionSkippedFiles: Array<SkippedUploadFile>
  selectionSkippedCount: number
  selectionWarning: string | null
  onSelectFiles: () => void
  onStartUpload: () => void
  onCloseBatch: () => void
  onDismissSelectionWarning: () => void
  onEntityChange: (entityId: number | null) => void
  onOpenBatch: (batchId: string | null | undefined) => void
  onOpenDestination: (documentId: string | null | undefined) => void
  onOpenRules: () => void
  onOpenStatusSheet: () => void
  onRefresh: () => void
  onRemoveSelectedFile: (clientId: string) => void
}) {
  const [activeFileTab, setActiveFileTab] = useState<ActiveBatchFileTab>('all')
  const [activePreviewLimit, setActivePreviewLimit] = useState(
    ACTIVE_BATCH_PREVIEW_INITIAL_LIMIT,
  )
  const [selectedFilesOpen, setSelectedFilesOpen] = useState(false)
  const [skippedFilesOpen, setSkippedFilesOpen] = useState(false)
  const showEmptyState = !activeBatch && rows.length === 0
  const canStartUpload = canSelectFiles && pendingSelections > 0
  const selectedRows = useMemo(
    () => rows.filter((row) => row.isPendingSelection),
    [rows],
  )
  const selectionSummary = useMemo(
    () => buildLocalSelectionSummary(localFiles),
    [localFiles],
  )
  const activeFileCounts = useMemo(() => {
    const localCounts = buildActiveBatchFileCounts(selectedRows)

    if (!activeBatch) {
      return buildActiveBatchFileCounts(rows)
    }

    return {
      all: activeBatch.totalFiles + localCounts.all,
      waiting: activeBatch.counts.pending + localCounts.waiting,
      processing:
        activeBatch.counts.uploaded +
        activeBatch.counts.queued +
        activeBatch.counts.processing +
        localCounts.processing,
      review: activeBatch.counts.review + localCounts.review,
      error: activeBatch.counts.error + localCounts.error,
      duplicate: activeBatch.counts.duplicate + localCounts.duplicate,
      completed: activeBatch.counts.success + localCounts.completed,
    }
  }, [activeBatch, rows, selectedRows])
  const filteredRows = useMemo(
    () =>
      activeFileTab === 'all'
        ? rows
        : rows.filter((row) => getActiveBatchFileTab(row) === activeFileTab),
    [activeFileTab, rows],
  )
  const previewLimit = Math.min(activePreviewLimit, ACTIVE_BATCH_PREVIEW_MAX)
  const previewRows = filteredRows.slice(0, previewLimit)
  const matchingRows = Math.max(
    activeFileCounts[activeFileTab],
    filteredRows.length,
  )
  const loadedHiddenRows = Math.max(filteredRows.length - previewRows.length, 0)
  const hiddenRows = Math.max(matchingRows - previewRows.length, 0)
  const showMoreCount = Math.min(
    ACTIVE_BATCH_PREVIEW_INCREMENT,
    ACTIVE_BATCH_PREVIEW_MAX - previewRows.length,
    loadedHiddenRows,
  )
  const canShowMorePreview = showMoreCount > 0
  const isPreviewCapped =
    hiddenRows > 0 && previewRows.length >= ACTIVE_BATCH_PREVIEW_MAX
  const activeFileTabChange = (value: string) => {
    setActiveFileTab(value as ActiveBatchFileTab)
    setActivePreviewLimit(ACTIVE_BATCH_PREVIEW_INITIAL_LIMIT)
  }
  const showMorePreview = () =>
    setActivePreviewLimit((current) =>
      Math.min(
        current + ACTIVE_BATCH_PREVIEW_INCREMENT,
        ACTIVE_BATCH_PREVIEW_MAX,
      ),
    )

  useEffect(
    () => setActivePreviewLimit(ACTIVE_BATCH_PREVIEW_INITIAL_LIMIT),
    [activeBatch?.id],
  )

  const hiddenRowsMessage = isPreviewCapped
    ? `Preview capped at ${ACTIVE_BATCH_PREVIEW_MAX.toLocaleString()} files. Use the table below for the full monitoring list.`
    : `${hiddenRows.toLocaleString()} more file${hiddenRows === 1 ? '' : 's'} match this view.`
  const showBatchLink =
    Boolean(activeBatch) &&
    (hiddenRows > 0 || matchingRows > previewRows.length)
  const activeFileSearch = getActiveFileSearch(activeFileTab)
  const uploadActionLabel =
    pendingSelections > 0 && pendingSelections === selectionSummary.errorCount
      ? `Retry failed (${pendingSelections})`
      : `Upload selected (${pendingSelections})`

  return (
    <Card
      size="sm"
      {...getProductTourTargetProps(UPLOAD_TOUR_TARGETS.activeBatch)}
      className={cn('gap-3 py-3', PANEL_CARD_CLASS)}
    >
      <CardHeader className={cn('gap-2 border-b pb-3', PANEL_BORDER_CLASS)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Badge variant="outline">Batch-based intake</Badge>
            <div className="flex flex-col gap-1">
              <CardTitle className="text-sm">
                {showEmptyState
                  ? 'Open an upload batch'
                  : 'Active upload batch'}
              </CardTitle>
              <CardDescription className="max-w-2xl text-xs leading-4">
                Upload multiple BIR 2307 PDFs into one batch, monitor each file
                independently, and close the batch only when you are done adding
                files.
              </CardDescription>
            </div>
          </div>
          <div
            {...getProductTourTargetProps(UPLOAD_TOUR_TARGETS.statusActions)}
            className="flex shrink-0 flex-wrap items-center justify-end gap-2"
          >
            {activeBatch ? (
              <StatusPill status={activeBatch.overallStatus} />
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="outline"
              {...getProductTourTargetProps(UPLOAD_TOUR_TARGETS.currentStatus)}
              onClick={onOpenStatusSheet}
            >
              <IconListDetails data-icon="inline-start" />
              Current status
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={onOpenRules}
            >
              <IconShieldCheck data-icon="inline-start" />
              Rules
            </Button>
            <InlineHelp label="Upload rules help">
              Rules shows file limits and batch behavior. Current status opens
              live counts, issues, and the same rules in a side panel.
            </InlineHelp>
            <RefreshStatus
              className="shrink-0"
              isRefreshing={isRefreshing}
              lastUpdatedLabel={lastRefreshedLabel}
              liveLabel={
                isAutoRefreshing ? 'Updating while work runs' : undefined
              }
              refreshLabel="Refresh active batch"
              onRefresh={onRefresh}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <BatchEntitySetup
          activeBatch={activeBatch}
          entities={entities}
          isLoading={isLoadingEntities}
          legacyBatchBlocksUpload={legacyBatchBlocksUpload}
          selectedEntityId={selectedEntityId}
          onEntityChange={onEntityChange}
        />

        {selectionWarning ? (
          <SelectionWarningAlert
            readyCount={selectedRows.length}
            skippedCount={selectionSkippedFiles.length}
            onDismiss={onDismissSelectionWarning}
            onReviewSkipped={() => setSkippedFilesOpen(true)}
          />
        ) : null}

        {selectedRows.length > 0 ? (
          <SelectedFilesSummary
            duplicateNameCount={selectionSummary.duplicateNameCount}
            errorCount={selectionSummary.errorCount}
            readyCount={selectionSummary.readyCount}
            selectedCount={selectionSummary.selectedCount}
            skippedCount={selectionSkippedCount}
            totalSizeBytes={selectionSummary.totalSizeBytes}
            onReview={() => setSelectedFilesOpen(true)}
            onReviewSkipped={() => setSkippedFilesOpen(true)}
          />
        ) : null}

        {showEmptyState ? (
          <div
            className={cn(
              'flex min-h-56 flex-col justify-between gap-4 rounded-lg border border-dashed bg-muted/10 p-4',
              PANEL_BORDER_CLASS,
            )}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex max-w-xl items-start gap-3">
                <div
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground',
                    PANEL_BORDER_CLASS,
                  )}
                >
                  <IconFolderOpen className="size-5" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold">
                    Start a reusable intake batch
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Select one or more PDFs to prepare a batch draft. Each PDF
                    must contain one BIR 2307 certificate. The batch is created
                    when you start the upload and stays open until you close it.
                  </p>
                </div>
              </div>
              <div className="grid gap-2 lg:min-w-72">
                <EmptyStateSupport
                  icon={<IconStack2 className="size-4" />}
                  title="Multiple files per batch"
                  detail="Group related uploads under one persisted intake batch."
                />
                <EmptyStateSupport
                  icon={<IconTimeline className="size-4" />}
                  title="Independent processing"
                  detail="Each file uploads, queues, and finishes on its own."
                />
                <EmptyStateSupport
                  icon={<IconShieldCheck className="size-4" />}
                  title="Resume later"
                  detail="Your open batch reappears when you return to /upload."
                />
              </div>
            </div>

            <div
              {...getProductTourTargetProps(UPLOAD_TOUR_TARGETS.batchActions)}
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-3 py-3',
                PANEL_BORDER_CLASS,
              )}
            >
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">
                  Ready to build a batch
                </p>
                <p className="text-xs text-muted-foreground">
                  {canSelectFiles
                    ? 'Choose PDF files now, then upload them together into a new intake batch.'
                    : 'Select an entity above, then choose PDF files for the intake batch.'}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                {...getProductTourTargetProps(UPLOAD_TOUR_TARGETS.selectFiles)}
                onClick={onSelectFiles}
                disabled={!canSelectFiles}
              >
                <IconFilePlus data-icon="inline-start" />
                Select PDF files
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={cn(
                'rounded-lg border bg-background p-2.5',
                PANEL_BORDER_CLASS,
              )}
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <div
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/20 text-muted-foreground',
                        PANEL_BORDER_CLASS,
                      )}
                    >
                      <IconStack2 className="size-4" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Batch
                        </p>
                        {activeBatch ? (
                          <Badge variant="outline">
                            {activeBatch.status === 'open' ? 'Open' : 'Closed'}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Draft</Badge>
                        )}
                      </div>
                      <p
                        className={cn(
                          'truncate text-sm font-semibold',
                          activeBatch?.name ? undefined : 'font-mono',
                        )}
                      >
                        {activeBatch
                          ? getBatchDisplayName(activeBatch)
                          : 'Pending creation'}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {activeBatch?.name ? (
                          <>
                            <span className="font-mono">{activeBatch.id}</span>
                            <span className="size-1 rounded-full bg-border" />
                          </>
                        ) : null}
                        <span>
                          {activeBatch
                            ? `${activeBatch.totalFiles} files in batch`
                            : `${rows.length} files selected`}
                        </span>
                        <span className="size-1 rounded-full bg-border" />
                        <span>
                          {activeBatch
                            ? `Last activity ${formatDateTime(activeBatch.lastActivityAt)}`
                            : 'Choose Upload selected to create the batch'}
                        </span>
                      </div>
                      {activeBatch ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          className="w-fit px-0 text-muted-foreground"
                          onClick={() => onOpenBatch(activeBatch.id)}
                        >
                          <IconArrowUpRight data-icon="inline-start" />
                          Open batch page
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {activeBatch ? (
                    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                      {buildActiveBatchSummaryItems(
                        activeBatch,
                        pendingSelections,
                      ).map((item) => (
                        <SummaryChip key={item.label} {...item} />
                      ))}
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <SummaryChip label="Selected" value={rows.length} />
                      <SummaryChip
                        label="Ready to upload"
                        value={pendingSelections}
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between">
                    <Tabs
                      value={activeFileTab}
                      onValueChange={activeFileTabChange}
                    >
                      <TabsList
                        className={cn(
                          'w-full justify-start overflow-x-auto rounded-md border p-0.5 sm:w-fit',
                          PANEL_BORDER_CLASS,
                        )}
                      >
                        <TabsTrigger value="all">
                          All ({activeFileCounts.all})
                        </TabsTrigger>
                        <TabsTrigger value="waiting">
                          Waiting ({activeFileCounts.waiting})
                        </TabsTrigger>
                        <TabsTrigger value="processing">
                          Processing ({activeFileCounts.processing})
                        </TabsTrigger>
                        <TabsTrigger value="error">
                          Errors ({activeFileCounts.error})
                        </TabsTrigger>
                        <TabsTrigger value="review">
                          Review ({activeFileCounts.review})
                        </TabsTrigger>
                        <TabsTrigger value="duplicate">
                          Duplicates ({activeFileCounts.duplicate})
                        </TabsTrigger>
                        <TabsTrigger value="completed">
                          Done ({activeFileCounts.completed})
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <Badge variant="outline" className="w-fit">
                      Showing {previewRows.length.toLocaleString()} of{' '}
                      {matchingRows.toLocaleString()}
                    </Badge>
                  </div>

                  {previewRows.length === 0 ? (
                    <div
                      className={cn(
                        'rounded-lg border border-dashed bg-muted/10 px-4 py-6 text-center text-xs text-muted-foreground',
                        PANEL_BORDER_CLASS,
                      )}
                    >
                      No files are in this status slice.
                    </div>
                  ) : (
                    <div className={cn(BATCH_PREVIEW_GRID_CLASS)}>
                      {previewRows.map((row) => (
                        <div
                          key={row.id}
                          className={cn(
                            'rounded-md border bg-muted/10 px-2 py-1.5',
                            PANEL_BORDER_CLASS,
                          )}
                        >
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <div className="flex min-w-0 items-start gap-2">
                              <div
                                className={cn(
                                  'flex size-6 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground',
                                  PANEL_BORDER_CLASS,
                                )}
                              >
                                <IconFileTypePdf className="size-3" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <p className="min-w-0 flex-1 truncate text-xs font-semibold">
                                    {row.fileName}
                                  </p>
                                  <StatusPill
                                    status={row.statusLabel}
                                    className="shrink-0"
                                  />
                                  {row.isPendingSelection ? (
                                    <Badge
                                      variant="outline"
                                      className="shrink-0"
                                    >
                                      Selected
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                  {formatBytes(row.sizeBytes)} · {row.detail}
                                </p>
                                {row.error ? (
                                  <p className="mt-0.5 truncate text-xs text-destructive">
                                    {row.error}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                            {row.canRemoveSelected ? (
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={`Remove selected PDF ${row.fileName}`}
                                title="Remove selected PDF"
                                onClick={() => onRemoveSelectedFile(row.id)}
                              >
                                <IconX />
                              </Button>
                            ) : null}
                          </div>

                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div
                                className="h-1.5 overflow-hidden rounded-full bg-muted"
                                role="progressbar"
                                aria-label={`${row.fileName} progress`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={row.progress}
                              >
                                <div
                                  className={cn(
                                    'h-1.5 rounded-full transition-[width] duration-700 ease-out',
                                    row.statusLabel === 'Error'
                                      ? 'bg-destructive/70'
                                      : row.statusLabel === 'Duplicate'
                                        ? 'bg-amber-500/70'
                                        : 'bg-primary/70',
                                  )}
                                  style={{
                                    width: `${Math.max(row.progress, 4)}%`,
                                  }}
                                />
                              </div>
                            </div>
                            <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
                              {row.progress}%
                            </span>
                            {row.uploadId ? (
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                onClick={() => onOpenDestination(row.uploadId)}
                              >
                                <IconArrowUpRight data-icon="inline-start" />
                                Open
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {hiddenRows > 0 ? (
                    <div
                      className={cn(
                        'flex flex-col gap-2 rounded-lg border bg-muted/10 px-3 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between',
                        PANEL_BORDER_CLASS,
                      )}
                    >
                      <span>{hiddenRowsMessage}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        {canShowMorePreview ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={showMorePreview}
                          >
                            Show {showMoreCount.toLocaleString()} more
                            <IconChevronRight data-icon="inline-end" />
                          </Button>
                        ) : null}
                        {showBatchLink && activeBatch ? (
                          <Link
                            to="/upload/batches/$batchId"
                            params={{ batchId: activeBatch.id }}
                            search={activeFileSearch}
                            className={buttonVariants({
                              size: 'sm',
                              variant: 'outline',
                            })}
                          >
                            Open full batch
                            <IconArrowUpRight data-icon="inline-end" />
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div
              {...getProductTourTargetProps(UPLOAD_TOUR_TARGETS.batchActions)}
              className={cn(
                'flex flex-col gap-2 rounded-lg border bg-muted/20 p-2',
                PANEL_BORDER_CLASS,
              )}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="xs"
                    {...getProductTourTargetProps(
                      UPLOAD_TOUR_TARGETS.selectFiles,
                    )}
                    onClick={onSelectFiles}
                    disabled={!canSelectFiles}
                  >
                    <IconFilePlus data-icon="inline-start" />
                    Add files
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant={canStartUpload ? 'default' : 'outline'}
                    onClick={onStartUpload}
                    disabled={!canStartUpload || isStartingUpload}
                  >
                    {isStartingUpload ? (
                      <IconLoader2
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <IconUpload data-icon="inline-start" />
                    )}
                    {isStartingUpload
                      ? 'Preparing batch...'
                      : canStartUpload
                        ? uploadActionLabel
                        : 'No files ready'}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={onCloseBatch}
                    disabled={
                      !activeBatch || hasBlockingLocalWork || isClosingBatch
                    }
                  >
                    <IconX data-icon="inline-start" />
                    Close batch
                  </Button>
                  <InlineHelp label="Close batch help">
                    Close the batch after the last PDF for this run has been
                    added. Keep it open while more files are still expected.
                  </InlineHelp>
                </div>
              </div>
            </div>
          </>
        )}
        <SelectedFilesSheet
          open={selectedFilesOpen}
          rows={selectedRows}
          onOpenChange={setSelectedFilesOpen}
          onRemoveSelectedFile={onRemoveSelectedFile}
        />
        <SkippedFilesSheet
          open={skippedFilesOpen}
          rows={selectionSkippedFiles}
          onOpenChange={setSkippedFilesOpen}
        />
      </CardContent>
    </Card>
  )
}

function SelectionWarningAlert({
  readyCount,
  skippedCount,
  onDismiss,
  onReviewSkipped,
}: {
  readyCount: number
  skippedCount: number
  onDismiss: () => void
  onReviewSkipped: () => void
}) {
  const readyLabel =
    readyCount === 1
      ? '1 file ready'
      : `${readyCount.toLocaleString()} files ready`
  const skippedLabel =
    skippedCount === 1
      ? '1 file skipped'
      : `${skippedCount.toLocaleString()} files skipped`

  return (
    <Alert
      className={cn(
        'border-amber-500/30 bg-amber-500/8 text-amber-900',
        '[&_[data-slot=alert-description]]:text-amber-900/80',
      )}
    >
      <IconAlertTriangle />
      <AlertTitle>Upload selection updated</AlertTitle>
      <AlertDescription>
        <span>
          {readyLabel}. {skippedLabel}.
        </span>
        {skippedCount > 0 ? (
          <div className="mt-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={onReviewSkipped}
            >
              <IconListDetails data-icon="inline-start" />
              Review skipped
            </Button>
          </div>
        ) : null}
      </AlertDescription>
      <AlertAction>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Dismiss file selection warning"
          onClick={onDismiss}
        >
          <IconX />
        </Button>
      </AlertAction>
    </Alert>
  )
}

function SelectedFilesSummary({
  selectedCount,
  readyCount,
  errorCount,
  duplicateNameCount,
  skippedCount,
  totalSizeBytes,
  onReview,
  onReviewSkipped,
}: {
  selectedCount: number
  readyCount: number
  errorCount: number
  duplicateNameCount: number
  skippedCount: number
  totalSizeBytes: number
  onReview: () => void
  onReviewSkipped: () => void
}) {
  return (
    <div
      className={cn('rounded-lg border bg-muted/10 p-3', PANEL_BORDER_CLASS)}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold">Selected files</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Review the staged PDF set before starting this batch upload.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {skippedCount > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onReviewSkipped}
            >
              <IconListDetails data-icon="inline-start" />
              Review skipped
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={onReview}>
            <IconListDetails data-icon="inline-start" />
            Review selected
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <SelectionMetric label="Selected" value={selectedCount} />
        <SelectionMetric label="Ready" value={readyCount} />
        <SelectionMetric label="Failed" value={errorCount} />
        <SelectionMetric label="Duplicate names" value={duplicateNameCount} />
        <SelectionMetric label="Skipped" value={skippedCount} />
        <SelectionMetric
          label="Total size"
          value={formatBytes(totalSizeBytes)}
        />
      </div>
    </div>
  )
}

function SelectionMetric({
  label,
  value,
}: {
  label: string
  value: number | string
}) {
  return (
    <div
      className={cn(
        'rounded-md border bg-background px-3 py-2',
        PANEL_BORDER_CLASS,
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function SelectedFilesSheet({
  open,
  rows,
  onOpenChange,
  onRemoveSelectedFile,
}: {
  open: boolean
  rows: Array<BatchFileRow>
  onOpenChange: (open: boolean) => void
  onRemoveSelectedFile: (clientId: string) => void
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const normalizedSearch = search.trim().toLowerCase()
  const filteredRows = useMemo(
    () =>
      normalizedSearch
        ? rows.filter((row) =>
            row.fileName.toLowerCase().includes(normalizedSearch),
          )
        : rows,
    [normalizedSearch, rows],
  )
  const pageSize = 25
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const visibleRows = filteredRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  )
  const startRow = filteredRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1
  const endRow = Math.min(safePage * pageSize, filteredRows.length)

  useEffect(() => {
    setPage(1)
  }, [search])

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={REVIEW_SHEET_CONTENT_CLASS}>
        <SheetHeader>
          <SheetTitle>Selected files</SheetTitle>
          <SheetDescription>
            Search and review the PDF files staged for this upload batch.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-6 pb-6">
          <div className="relative min-w-0">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search selected files"
              value={search}
              className="pl-9"
              placeholder="Search selected files"
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </div>

          <div
            className={cn(
              'overflow-hidden rounded-lg border bg-background',
              PANEL_BORDER_CLASS,
            )}
          >
            <Table className="min-w-[620px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
              <TableHeader className="[&_tr]:border-border/60">
                <TableRow className="bg-muted/35 hover:bg-muted/35">
                  <TableHead className="bg-muted/35">File</TableHead>
                  <TableHead className="bg-muted/35">Status</TableHead>
                  <TableHead className="bg-muted/35 text-right">Size</TableHead>
                  <TableHead className="bg-muted/35 text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child]:border-b-0">
                {visibleRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No selected files match this search.
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="border-border/60 bg-background hover:bg-muted/35"
                    >
                      <TableCell className="max-w-[24rem] align-top">
                        <span className="truncate text-xs font-semibold">
                          {row.fileName}
                        </span>
                        {row.error ? (
                          <p className="mt-1 text-xs leading-5 text-destructive">
                            {row.error}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top">
                        <StatusPill status={row.statusLabel} />
                      </TableCell>
                      <TableCell className="text-right align-top text-muted-foreground">
                        {formatBytes(row.sizeBytes)}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex justify-end">
                          {row.canRemoveSelected ? (
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Remove selected PDF ${row.fileName}`}
                              title="Remove selected PDF"
                              onClick={() => onRemoveSelectedFile(row.id)}
                            >
                              <IconX />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {startRow}-{endRow} of{' '}
              {filteredRows.length.toLocaleString()} selected files
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safePage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <IconChevronLeft data-icon="inline-start" />
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safePage >= totalPages}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
              >
                Next
                <IconChevronRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

const getSkippedReasonLabel = (reason: SkippedUploadFile['reason']) => {
  switch (reason) {
    case 'empty':
      return 'Empty file'
    case 'too_large':
      return 'Too large'
    case 'not_pdf':
      return 'Not a PDF'
    case 'encrypted':
      return 'Encrypted PDF'
  }
}

function SkippedFilesSheet({
  open,
  rows,
  onOpenChange,
}: {
  open: boolean
  rows: Array<SkippedUploadFile>
  onOpenChange: (open: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const normalizedSearch = search.trim().toLowerCase()
  const filteredRows = useMemo(
    () =>
      normalizedSearch
        ? rows.filter(
            (row) =>
              row.fileName.toLowerCase().includes(normalizedSearch) ||
              row.message.toLowerCase().includes(normalizedSearch) ||
              getSkippedReasonLabel(row.reason)
                .toLowerCase()
                .includes(normalizedSearch),
          )
        : rows,
    [normalizedSearch, rows],
  )
  const pageSize = 25
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const visibleRows = filteredRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  )
  const startRow = filteredRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1
  const endRow = Math.min(safePage * pageSize, filteredRows.length)

  useEffect(() => {
    setPage(1)
  }, [search])

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={REVIEW_SHEET_CONTENT_CLASS}>
        <SheetHeader>
          <SheetTitle>Skipped files</SheetTitle>
          <SheetDescription>
            Review files that were not staged for this upload batch.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-6 pb-6">
          <div className="relative min-w-0">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search skipped files"
              value={search}
              className="pl-9"
              placeholder="Search skipped files"
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </div>

          <div
            className={cn(
              'overflow-hidden rounded-lg border bg-background',
              PANEL_BORDER_CLASS,
            )}
          >
            <Table className="min-w-[620px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
              <TableHeader className="[&_tr]:border-border/60">
                <TableRow className="bg-muted/35 hover:bg-muted/35">
                  <TableHead className="bg-muted/35">File</TableHead>
                  <TableHead className="bg-muted/35">Issue</TableHead>
                  <TableHead className="bg-muted/35 text-right">Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child]:border-b-0">
                {visibleRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No skipped files match this search.
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="border-border/60 bg-background hover:bg-muted/35"
                    >
                      <TableCell className="max-w-[24rem] align-top">
                        <span className="block truncate text-xs font-semibold">
                          {row.fileName}
                        </span>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline" className="w-fit">
                            {getSkippedReasonLabel(row.reason)}
                          </Badge>
                          <span className="text-xs leading-5 text-muted-foreground">
                            {row.message}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right align-top text-muted-foreground">
                        {formatBytes(row.sizeBytes)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {startRow}-{endRow} of{' '}
              {filteredRows.length.toLocaleString()} skipped files
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safePage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <IconChevronLeft data-icon="inline-start" />
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={safePage >= totalPages}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
              >
                Next
                <IconChevronRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function EmptyStateSupport({
  icon,
  title,
  detail,
}: {
  icon: ReactNode
  title: string
  detail: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border bg-background px-3 py-2.5',
        PANEL_BORDER_CLASS,
      )}
    >
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/20 text-muted-foreground',
          PANEL_BORDER_CLASS,
        )}
      >
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function SummaryChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'warning'
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'flex h-7 w-full items-center justify-between gap-2 rounded-md border px-2 text-left',
        tone === 'warning'
          ? 'border-amber-500/25 bg-amber-500/8 text-amber-700'
          : 'border-border/70 bg-muted/20 text-foreground',
      )}
    >
      <span className="rounded-md bg-background px-1.5 py-0.5 text-xs font-semibold tabular-nums">
        {value}
      </span>
      <span className="truncate text-xs leading-none">{label}</span>
    </Badge>
  )
}

function SelectedUploadTray({
  canSelectFiles,
  canStartUpload,
  isStartingUpload,
  localFiles,
  pendingSelections,
  onSelectFiles,
  onStartUpload,
}: {
  canSelectFiles: boolean
  canStartUpload: boolean
  isStartingUpload: boolean
  localFiles: Array<LocalUploadItem>
  pendingSelections: number
  onSelectFiles: () => void
  onStartUpload: () => void
}) {
  const selectionSummary = useMemo(
    () => buildLocalSelectionSummary(localFiles),
    [localFiles],
  )
  const visibleFiles = localFiles.slice(0, 3)
  const hiddenCount = Math.max(localFiles.length - visibleFiles.length, 0)

  if (localFiles.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        'sticky bottom-3 rounded-lg border bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/85',
        PANEL_BORDER_CLASS,
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Selected PDFs</p>
            <Badge variant="outline">
              {selectionSummary.selectedCount.toLocaleString()} selected
            </Badge>
            <Badge variant="outline">
              {formatBytes(selectionSummary.totalSizeBytes)}
            </Badge>
            {selectionSummary.errorCount > 0 ? (
              <Badge variant="outline">
                {selectionSummary.errorCount.toLocaleString()} failed
              </Badge>
            ) : null}
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            {visibleFiles.map((file) => (
              <div
                key={file.clientId}
                className={cn(
                  'flex max-w-72 items-center gap-2 rounded-md border bg-muted/20 px-2 py-1.5',
                  PANEL_BORDER_CLASS,
                )}
              >
                <IconFileTypePdf className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-medium">
                  {file.file.name}
                </span>
                <StatusPill status={file.status} />
              </div>
            ))}
            {hiddenCount > 0 ? (
              <Badge variant="outline">
                +{hiddenCount.toLocaleString()} more
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onSelectFiles}
            disabled={!canSelectFiles}
          >
            <IconFilePlus data-icon="inline-start" />
            Add files
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onStartUpload}
            disabled={!canStartUpload || isStartingUpload}
          >
            {isStartingUpload ? (
              <IconLoader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <IconUpload data-icon="inline-start" />
            )}
            {isStartingUpload
              ? 'Preparing batch...'
              : pendingSelections > 0
                ? `Upload selected (${pendingSelections})`
                : 'No files ready'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function BatchStatusSheet({
  activeBatch,
  attentionError,
  items,
  metrics,
  open,
  recentBatches,
  tab,
  totalAttentionCount,
  onOpenBatch,
  onOpenChange,
  onOpenDestination,
  onTabChange,
}: {
  activeBatch: IntakeBatchView | null
  attentionError: string | null
  items: ReturnType<typeof buildNeedsAttentionItems>
  metrics: ReturnType<typeof buildQueueMetrics>
  open: boolean
  recentBatches: Array<IntakeBatchView>
  tab: BatchStatusTab
  totalAttentionCount: number
  onOpenBatch: (batchId: string | null | undefined) => void
  onOpenChange: (open: boolean) => void
  onOpenDestination: (documentId: string | null | undefined) => void
  onTabChange: (tab: BatchStatusTab) => void
}) {
  const recentPreview = recentBatches
    .filter((batch) => batch.id !== activeBatch?.id)
    .slice(0, 3)
  const timeline = buildBatchStatusTimeline(activeBatch)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={STATUS_SHEET_CONTENT_CLASS}
        {...getProductTourTargetProps(UPLOAD_TOUR_TARGETS.statusSheet)}
      >
        <SheetHeader>
          <SheetTitle>Current Batch Status</SheetTitle>
          <SheetDescription>
            Live upload, processing, attention, and rules context for the active
            batch.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-6 pb-6">
          <Tabs
            value={tab}
            onValueChange={(value) => onTabChange(value as BatchStatusTab)}
          >
            <TabsList
              {...getProductTourTargetProps(
                UPLOAD_TOUR_TARGETS.statusSheetTabs,
              )}
              className={cn(
                'w-full justify-start overflow-x-auto rounded-lg border p-1 sm:w-fit',
                PANEL_BORDER_CLASS,
              )}
            >
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="issues">Issues</TabsTrigger>
              <TabsTrigger value="rules">Rules</TabsTrigger>
            </TabsList>

            <TabsContent
              value="summary"
              className="flex flex-col gap-4"
              {...getProductTourTargetProps(
                UPLOAD_TOUR_TARGETS.statusSheetSummary,
              )}
            >
              <div
                className={cn(
                  'rounded-lg border bg-muted/10 p-3',
                  PANEL_BORDER_CLASS,
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      Active batch
                    </p>
                    <p
                      className={cn(
                        'mt-1 truncate text-sm font-semibold',
                        activeBatch?.name ? undefined : 'font-mono',
                      )}
                    >
                      {activeBatch
                        ? getBatchDisplayName(activeBatch)
                        : 'No active batch'}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {activeBatch
                        ? `${activeBatch.totalFiles.toLocaleString()} files · last activity ${formatDateTime(activeBatch.lastActivityAt)}`
                        : 'Select an entity and add PDFs to create the next batch.'}
                    </p>
                  </div>
                  {activeBatch ? (
                    <StatusPill status={activeBatch.overallStatus} />
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className={cn(
                      'rounded-lg border bg-background p-3',
                      PANEL_BORDER_CLASS,
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'flex size-7 items-center justify-center rounded-md border bg-muted/20 text-muted-foreground',
                          PANEL_BORDER_CLASS,
                        )}
                      >
                        {getQueueMetricIcon(metric.label)}
                      </span>
                      <p className="text-xs font-medium text-muted-foreground">
                        {metric.label}
                      </p>
                    </div>
                    <p className="mt-2 text-xl font-semibold tabular-nums">
                      {metric.value}
                    </p>
                  </div>
                ))}
              </div>

              <div
                className={cn(
                  'rounded-lg border bg-background p-3',
                  PANEL_BORDER_CLASS,
                )}
              >
                <p className="text-sm font-semibold">Processing timeline</p>
                <div className="mt-3 flex flex-col gap-2">
                  {timeline.length === 0 ? (
                    <p className="text-xs leading-5 text-muted-foreground">
                      A timeline appears here after the batch is created.
                    </p>
                  ) : (
                    timeline.map((step) => (
                      <div
                        key={step.label}
                        className="flex items-center justify-between gap-3"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <StatusPill status={step.status} />
                          <span className="truncate text-sm">{step.label}</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums">
                          {step.value.toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {recentPreview.length > 0 ? (
                <div
                  className={cn(
                    'rounded-lg border bg-muted/10 p-3',
                    PANEL_BORDER_CLASS,
                  )}
                >
                  <p className="text-sm font-semibold">Recent completed runs</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {recentPreview.map((batch) => (
                      <button
                        key={batch.id}
                        type="button"
                        className={cn(
                          'flex min-w-0 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-left',
                          PANEL_BORDER_CLASS,
                        )}
                        onClick={() => onOpenBatch(batch.id)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold">
                            {getBatchDisplayName(batch)}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {batch.totalFiles.toLocaleString()} files ·{' '}
                            {formatDateTime(batch.lastActivityAt)}
                          </span>
                        </span>
                        <StatusPill status={batch.overallStatus} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </TabsContent>

            <TabsContent
              value="issues"
              className="flex flex-col gap-3"
              {...getProductTourTargetProps(
                UPLOAD_TOUR_TARGETS.statusSheetIssues,
              )}
            >
              {attentionError ? (
                <Alert variant="destructive" className="rounded-lg">
                  <IconAlertTriangle />
                  <AlertTitle>Unable to load attention preview</AlertTitle>
                  <AlertDescription>{attentionError}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Open attention items</p>
                <Badge variant="outline">
                  {totalAttentionCount.toLocaleString()} open
                </Badge>
              </div>
              {items.length === 0 ? (
                <div
                  className={cn(
                    'rounded-lg border bg-muted/10 p-3 text-xs leading-5 text-muted-foreground',
                    PANEL_BORDER_CLASS,
                  )}
                >
                  No uploads currently need review.
                </div>
              ) : (
                <>
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        'rounded-lg border bg-background p-3',
                        PANEL_BORDER_CLASS,
                      )}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold">
                              {item.fileName}
                            </p>
                            <StatusPill status={item.statusLabel} />
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {item.message}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenDestination(item.id)}
                        >
                          <IconArrowUpRight data-icon="inline-start" />
                          {item.actionLabel}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {activeBatch && totalAttentionCount > items.length ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-fit"
                      onClick={() => onOpenBatch(activeBatch.id)}
                    >
                      <IconArrowUpRight data-icon="inline-start" />
                      Open full attention list
                    </Button>
                  ) : null}
                </>
              )}
            </TabsContent>

            <TabsContent
              value="rules"
              className="flex flex-col gap-3"
              {...getProductTourTargetProps(
                UPLOAD_TOUR_TARGETS.statusSheetRules,
              )}
            >
              <UploadRulesList />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function RecentBatchesCard({
  activeBatch,
  recentBatches,
  onOpenBatch,
}: {
  activeBatch: IntakeBatchView | null
  recentBatches: Array<IntakeBatchView>
  onOpenBatch: (batchId: string | null | undefined) => void
}) {
  const batches = activeBatch
    ? [
        activeBatch,
        ...recentBatches.filter((batch) => batch.id !== activeBatch.id),
      ]
    : recentBatches
  const previewBatches = batches.slice(0, 4)

  return (
    <Card
      size="sm"
      {...getProductTourTargetProps(UPLOAD_TOUR_TARGETS.recentBatches)}
      className={PANEL_CARD_CLASS}
    >
      <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm">Recent batches</CardTitle>
              <Badge variant="outline">{batches.length} batches</Badge>
            </div>
            <CardDescription className="mt-1 text-xs">
              A compact view of recent upload batch activity.
            </CardDescription>
          </div>
          <Link
            to="/batches"
            search={defaultBatchSearch}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            View all batches
            <IconArrowUpRight data-icon="inline-end" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {batches.length === 0 ? (
          <div
            className={cn(
              'flex items-center gap-3 rounded-lg border bg-muted/10 p-3 text-xs text-muted-foreground',
              PANEL_BORDER_CLASS,
            )}
          >
            <div
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background',
                PANEL_BORDER_CLASS,
              )}
            >
              <IconStack2 className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                No recent batches yet.
              </p>
              <p className="mt-1 leading-5">
                Your current open batch and older batches will appear here once
                upload activity begins.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {previewBatches.map((batch) => (
              <div
                key={batch.id}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between',
                  PANEL_BORDER_CLASS,
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={cn(
                        'truncate text-sm font-medium',
                        batch.name ? undefined : 'font-mono',
                      )}
                    >
                      {getBatchDisplayName(batch)}
                    </p>
                    {activeBatch?.id === batch.id ? (
                      <Badge variant="outline">Current</Badge>
                    ) : null}
                    {batch.entity?.shortName ? (
                      <Badge variant="outline">{batch.entity.shortName}</Badge>
                    ) : null}
                    <StatusPill status={batch.overallStatus} />
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {batch.totalFiles.toLocaleString()} files ·{' '}
                    {batch.counts.success.toLocaleString()} done ·{' '}
                    {batch.counts.error.toLocaleString()} errors,{' '}
                    {batch.counts.duplicate.toLocaleString()} duplicates
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last activity {formatDateTime(batch.lastActivityAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="w-fit shrink-0"
                  onClick={() => onOpenBatch(batch.id)}
                >
                  <IconArrowUpRight data-icon="inline-start" />
                  Open
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function UploadRulesList() {
  const rules = getUploadRules()
  return (
    <div className="flex flex-col gap-3">
      {rules.map((rule) => (
        <div
          key={rule.title}
          className={cn(
            'flex items-start gap-3 rounded-lg border bg-muted/10 p-3',
            PANEL_BORDER_CLASS,
          )}
        >
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-primary',
              PANEL_BORDER_CLASS,
            )}
          >
            {rule.icon}
          </span>
          <div>
            <p className="text-sm font-medium">{rule.title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {rule.detail}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function getQueueMetricIcon(label: string) {
  switch (label) {
    case 'Waiting':
      return <IconTimeline className="size-4" />
    case 'Processing':
      return <IconLoader2 className="size-4" />
    case 'Errors':
      return <IconAlertTriangle className="size-4" />
    case 'Review':
      return <IconScanEye className="size-4" />
    case 'Duplicates':
      return <IconStack2 className="size-4" />
    case 'Completed':
      return <IconChecks className="size-4" />
    default:
      return <IconCheck className="size-4" />
  }
}

const getJobsFullCount = (
  activeBatch: IntakeBatchView | null,
  jobsTab: JobsTab,
  statusFilter: JobsStatusFilter,
) => {
  if (!activeBatch) {
    return null
  }

  if (statusFilter !== 'all') {
    switch (statusFilter) {
      case 'waiting':
        return (
          activeBatch.counts.pending +
          activeBatch.counts.uploaded +
          activeBatch.counts.queued
        )
      case 'processing':
        return activeBatch.counts.processing
      case 'completed':
        return activeBatch.counts.success
      case 'review':
        return activeBatch.counts.review
      case 'duplicate':
        return activeBatch.counts.duplicate
      case 'error':
        return activeBatch.counts.error
      default:
        return activeBatch.totalFiles
    }
  }

  switch (jobsTab) {
    case 'processing':
      return (
        activeBatch.counts.pending +
        activeBatch.counts.uploaded +
        activeBatch.counts.queued +
        activeBatch.counts.processing
      )
    case 'completed':
      return activeBatch.counts.success
    case 'review':
      return activeBatch.counts.review
    case 'error':
      return activeBatch.counts.error
    case 'duplicate':
      return activeBatch.counts.duplicate
    default:
      return activeBatch.totalFiles
  }
}

const getJobsFullBatchSearch = (
  jobsTab: JobsTab,
  statusFilter: JobsStatusFilter,
) => {
  if (statusFilter === 'completed' || jobsTab === 'completed') {
    return {
      ...defaultBatchDetailSearch,
      tab: 'files' as const,
      status: 'success' as const,
    }
  }

  if (statusFilter === 'error' || jobsTab === 'error') {
    return {
      ...defaultBatchDetailSearch,
      tab: 'files' as const,
      status: 'error' as const,
    }
  }

  if (statusFilter === 'review' || jobsTab === 'review') {
    return {
      ...defaultBatchDetailSearch,
      tab: 'files' as const,
      status: 'manual_review' as const,
    }
  }

  if (statusFilter === 'duplicate' || jobsTab === 'duplicate') {
    return {
      ...defaultBatchDetailSearch,
      tab: 'files' as const,
      status: 'duplicate' as const,
    }
  }

  if (statusFilter === 'processing' || jobsTab === 'processing') {
    return {
      ...defaultBatchDetailSearch,
      tab: 'files' as const,
      status: 'processing' as const,
    }
  }

  return { ...defaultBatchDetailSearch, tab: 'files' as const }
}

function JobsTable({
  activeBatch,
  jobsTab,
  jobsSearch,
  jobsModel,
  isRefreshing,
  isAutoRefreshing,
  lastRefreshedLabel,
  statusFilter,
  onJobsSearchChange,
  onJobsTabChange,
  onOpenDestination,
  onRefresh,
  onStatusFilterChange,
}: {
  activeBatch: IntakeBatchView | null
  jobsTab: JobsTab
  jobsSearch: string
  jobsModel: ReturnType<typeof buildJobsModel>
  isRefreshing: boolean
  isAutoRefreshing: boolean
  lastRefreshedLabel: string
  statusFilter: JobsStatusFilter
  onJobsSearchChange: (value: string) => void
  onJobsTabChange: (value: JobsTab) => void
  onOpenDestination: (documentId: string | null | undefined) => void
  onRefresh: () => void
  onStatusFilterChange: (value: JobsStatusFilter) => void
}) {
  const previewRows = jobsModel.rows.slice(0, JOBS_TABLE_PREVIEW_LIMIT)
  const fullCount =
    jobsSearch.trim().length === 0
      ? getJobsFullCount(activeBatch, jobsTab, statusFilter)
      : null
  const matchingRows = fullCount ?? jobsModel.rows.length
  const hiddenRows = Math.max(matchingRows - previewRows.length, 0)
  const displayedCounts = activeBatch
    ? {
        all: activeBatch.totalFiles,
        processing:
          activeBatch.counts.pending +
          activeBatch.counts.uploaded +
          activeBatch.counts.queued +
          activeBatch.counts.processing,
        completed: activeBatch.counts.success,
        review: activeBatch.counts.review,
        error: activeBatch.counts.error,
        duplicate: activeBatch.counts.duplicate,
      }
    : jobsModel.counts
  const fullBatchSearch = getJobsFullBatchSearch(jobsTab, statusFilter)

  return (
    <Card
      size="sm"
      {...getProductTourTargetProps(UPLOAD_TOUR_TARGETS.statusTable)}
      className={PANEL_CARD_CLASS}
    >
      <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-col gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-sm">
                  Certificate status table
                </CardTitle>
                <InlineHelp label="Certificate status table help">
                  Filter this table to find files in progress, completed
                  certificates, duplicates, or errors.
                </InlineHelp>
                <Badge variant="outline">
                  {displayedCounts.all.toLocaleString()} active
                </Badge>
              </div>
              <CardDescription className="mt-1 text-xs">
                Active batch certificates with status, outcome, and next action.
              </CardDescription>
            </div>
            <Tabs
              value={jobsTab}
              onValueChange={(value) => onJobsTabChange(value as JobsTab)}
            >
              <TabsList
                className={cn(
                  'w-full justify-start overflow-x-auto rounded-lg border p-1 sm:w-fit',
                  PANEL_BORDER_CLASS,
                )}
              >
                <TabsTrigger value="all">
                  All ({displayedCounts.all})
                </TabsTrigger>
                <TabsTrigger value="processing">
                  Processing ({displayedCounts.processing})
                </TabsTrigger>
                <TabsTrigger value="completed">
                  Completed ({displayedCounts.completed})
                </TabsTrigger>
                <TabsTrigger value="review">
                  Review ({displayedCounts.review})
                </TabsTrigger>
                <TabsTrigger value="error">
                  Errors ({displayedCounts.error})
                </TabsTrigger>
                <TabsTrigger value="duplicate">
                  Duplicates ({displayedCounts.duplicate})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div
            className={cn(
              'flex flex-col gap-2 rounded-lg border bg-muted/20 p-2 sm:flex-row sm:items-center',
              PANEL_BORDER_CLASS,
            )}
          >
            <div className="relative min-w-0 sm:w-72">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search filename"
                placeholder="Search active files"
                value={jobsSearch}
                onChange={(event) => onJobsSearchChange(event.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                onStatusFilterChange(value as JobsStatusFilter)
              }
            >
              <SelectTrigger
                aria-label="Status filter"
                className="w-full sm:w-[12.5rem]"
              >
                <SelectValue placeholder="Status filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <RefreshStatus
              isRefreshing={isRefreshing}
              lastUpdatedLabel={lastRefreshedLabel}
              liveLabel={
                isAutoRefreshing ? 'Updating while work runs' : undefined
              }
              refreshLabel="Refresh upload jobs"
              onRefresh={onRefresh}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {jobsModel.rows.length === 0 ? (
          <div
            className={cn(
              'flex flex-col items-center gap-3 rounded-lg border border-dashed bg-muted/10 px-4 py-8 text-center text-xs text-muted-foreground',
              PANEL_BORDER_CLASS,
            )}
          >
            <div
              className={cn(
                'flex size-10 items-center justify-center rounded-lg border bg-background',
                PANEL_BORDER_CLASS,
              )}
            >
              <IconSearch className="size-4" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">
                No files match the current filters.
              </p>
              <p>Try a broader search or reset the status filter.</p>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'overflow-hidden rounded-lg border bg-background',
              PANEL_BORDER_CLASS,
            )}
          >
            <Table className="min-w-[860px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
              <TableHeader className="[&_tr]:border-border/60">
                <TableRow className="bg-muted/35 hover:bg-muted/35">
                  <TableHead className="bg-muted/35">File</TableHead>
                  <TableHead className="bg-muted/35">Step / result</TableHead>
                  <TableHead className="bg-muted/35">Status</TableHead>
                  <TableHead className="bg-muted/35">Updated</TableHead>
                  <TableHead className="bg-muted/35 text-right">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child]:border-b-0">
                {previewRows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="border-border/60 bg-background hover:bg-muted/35"
                  >
                    <TableCell className="max-w-[22rem] whitespace-normal align-top">
                      <div className="flex items-start gap-2">
                        <div
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/20 text-muted-foreground',
                            PANEL_BORDER_CLASS,
                          )}
                        >
                          <IconFileTypePdf className="size-4" />
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="truncate text-xs font-semibold">
                            {row.fileName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(row.sizeBytes)}
                          </span>
                          {row.issueSummary ? (
                            <span className="line-clamp-2 text-xs text-muted-foreground">
                              {row.issueSummary}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {row.resultLabel}
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusPill status={row.statusLabel} />
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {row.updatedAt}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <Button
                        type="button"
                        size="xs"
                        variant={
                          row.actionLabel === 'Review issue'
                            ? 'default'
                            : 'outline'
                        }
                        onClick={() => onOpenDestination(row.id)}
                      >
                        <IconArrowUpRight data-icon="inline-start" />
                        {row.actionLabel}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {hiddenRows > 0 ? (
              <div
                className={cn(
                  'flex flex-col gap-2 border-t bg-muted/10 px-3 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between',
                  PANEL_BORDER_CLASS,
                )}
              >
                <span>
                  Showing first {previewRows.length.toLocaleString()} matching
                  preview files. {hiddenRows.toLocaleString()} more file
                  {hiddenRows === 1 ? '' : 's'} are available in the batch
                  detail page.
                </span>
                {activeBatch ? (
                  <Link
                    to="/upload/batches/$batchId"
                    params={{ batchId: activeBatch.id }}
                    search={fullBatchSearch}
                    className={buttonVariants({
                      size: 'sm',
                      variant: 'outline',
                    })}
                  >
                    Open full batch
                    <IconArrowUpRight data-icon="inline-end" />
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
