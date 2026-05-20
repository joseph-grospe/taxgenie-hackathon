import type {
  IntakeUploadView,
  LocalUploadItem,
  StatusSummary,
} from '@/lib/upload-intake-types'

export type WorkflowCardState =
  | 'empty'
  | 'selected'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'needs_review'

export type WorkflowStageStatus = 'complete' | 'active' | 'pending' | 'error'

export type WorkflowStage = {
  key:
    | 'upload_received'
    | 'transfer_complete'
    | 'detecting_pages'
    | 'ocr_validation'
    | 'saving_results'
    | 'complete'
  label: string
  status: WorkflowStageStatus
}

export type CurrentUploadActionId =
  | 'start_upload'
  | 'select_file'
  | 'open_results'
  | 'view_details'
  | 'review_issue'
  | 'retry'

export type CurrentUploadAction = {
  id: CurrentUploadActionId
  label: string
  variant: 'default' | 'outline' | 'ghost'
}

export type UploadSummaryChip = {
  label: string
  value: number
  tone: 'neutral' | 'success' | 'warning'
  placeholder?: boolean
}

export type CurrentUploadCardModel = {
  state: WorkflowCardState
  title: string
  fileName: string | null
  sizeBytes: number | null
  statusLabel: string
  helperText: string
  detailText: string
  errorMessage: string | null
  summaryChips: Array<UploadSummaryChip>
  summaryFallbackLabel: string | null
  stages: Array<WorkflowStage>
  actions: Array<CurrentUploadAction>
  uploadId: string | null
  note: string
}

export type QueueMetric = {
  label: string
  value: number
}

export type JobsTab = 'all' | 'processing' | 'completed' | 'needs_review'

export type JobsStatusFilter =
  | 'all'
  | 'waiting'
  | 'processing'
  | 'completed'
  | 'duplicate'
  | 'needs_review'
  | 'failed'

export type UploadJobRowModel = {
  id: string
  fileName: string
  sizeBytes: number
  resultLabel: string
  statusLabel: string
  statusFilter: Exclude<JobsStatusFilter, 'all'>
  hasOpenAttention: boolean
  updatedAt: string
  actionLabel: string
  actionId: 'open_results' | 'view_details' | 'review_issue'
  issueSummary: string | null
}

export type NeedsAttentionItem = {
  id: string
  fileName: string
  statusLabel: string
  message: string
  actionLabel: string
}

export type JobsModel = {
  rows: Array<UploadJobRowModel>
  counts: Record<JobsTab, number>
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const STAGE_KEYS: Array<WorkflowStage['key']> = [
  'upload_received',
  'transfer_complete',
  'detecting_pages',
  'ocr_validation',
  'saving_results',
  'complete',
]

const STAGE_LABELS: Record<WorkflowStage['key'], string> = {
  upload_received: 'Upload received',
  transfer_complete: 'Transfer complete',
  detecting_pages: 'Detecting certificate',
  ocr_validation: 'OCR & validation',
  saving_results: 'Saving results',
  complete: 'Complete',
}

const STEP_STAGE_BY_TOKEN: Array<{
  stage: WorkflowStage['key']
  matches: Array<string>
}> = [
  {
    stage: 'detecting_pages',
    matches: ['load_input', 'extract_document'],
  },
  {
    stage: 'ocr_validation',
    matches: [
      'normalize_fields',
      'check_masterlist',
      'validate_rules',
      'dedupe_check',
    ],
  },
  {
    stage: 'saving_results',
    matches: [
      'persist_validation_fail',
      'persist_duplicate',
      'persist_validated',
      'finalize_workflow',
    ],
  },
]

const UPLOAD_NOTE =
  'One PDF must contain one BIR 2307 certificate. Non-certificate pages are ignored.'

const humanizeToken = (value: string | null | undefined) => {
  if (!value) {
    return ''
  }

  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (token) => token.toUpperCase())
}

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return '—'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return DATE_TIME_FORMATTER.format(parsed)
}

const hasOpenAttention = (upload: IntakeUploadView) =>
  ['duplicate', 'error'].includes(upload.overallStatus) &&
  upload.attentionStatus !== 'resolved'

export const getLatestActivity = (upload: IntakeUploadView) =>
  upload.processingFinishedAt ??
  upload.processingStartedAt ??
  upload.queuedAt ??
  upload.uploadedAt

const normalizeServerWorkflowState = (
  upload: IntakeUploadView,
): WorkflowCardState => {
  switch (upload.overallStatus) {
    case 'success':
    case 'completed':
      return 'completed'
    case 'duplicate':
      return 'needs_review'
    case 'error':
      return 'failed'
    case 'processing':
    case 'queued':
    case 'uploaded':
      return 'processing'
    default:
      return 'empty'
  }
}

const normalizeLocalWorkflowState = (
  localUpload: LocalUploadItem,
): WorkflowCardState => {
  switch (localUpload.status) {
    case 'Pending':
      return 'selected'
    case 'Requesting':
    case 'Uploading':
      return 'uploading'
    case 'Queueing':
    case 'Queued':
    case 'Processing':
      return 'processing'
    case 'Done':
      return 'completed'
    case 'Duplicate':
      return 'needs_review'
    case 'Error':
      return 'failed'
    default:
      return 'empty'
  }
}

const isTerminalWorkflowState = (state: WorkflowCardState) =>
  state === 'completed' || state === 'needs_review' || state === 'failed'

const resolveLocalCardState = (
  localUpload: LocalUploadItem,
  matchedUpload: IntakeUploadView | null,
) => {
  const localState = normalizeLocalWorkflowState(localUpload)
  const serverState = matchedUpload
    ? normalizeServerWorkflowState(matchedUpload)
    : null

  if (serverState && isTerminalWorkflowState(serverState)) {
    return serverState
  }

  return localState
}

const toDisplayStatusLabel = (state: WorkflowCardState) => {
  switch (state) {
    case 'selected':
      return 'Ready'
    case 'uploading':
    case 'processing':
      return 'Processing'
    case 'completed':
      return 'Completed'
    case 'needs_review':
      return 'Needs review'
    case 'failed':
      return 'Failed'
    default:
      return 'Pending'
  }
}

const getActiveServerStage = (
  upload: IntakeUploadView,
): WorkflowStage['key'] => {
  if (upload.overallStatus === 'uploaded') {
    return 'detecting_pages'
  }

  if (upload.overallStatus === 'queued') {
    return 'detecting_pages'
  }

  const stepToken = upload.currentStep?.trim().toLowerCase()
  if (stepToken) {
    const matchedStage = STEP_STAGE_BY_TOKEN.find((item) =>
      item.matches.includes(stepToken),
    )

    if (matchedStage) {
      return matchedStage.stage
    }
  }

  if (upload.overallStatus === 'processing') {
    return 'ocr_validation'
  }

  return 'complete'
}

const buildStageList = (
  completedCount: number,
  activeStage: WorkflowStage['key'] | null,
  activeStatus: Extract<WorkflowStageStatus, 'active' | 'error'> | null,
): Array<WorkflowStage> =>
  STAGE_KEYS.map((key, index) => {
    if (index < completedCount) {
      return {
        key,
        label: STAGE_LABELS[key],
        status: 'complete',
      }
    }

    if (key === activeStage && activeStatus) {
      return {
        key,
        label: STAGE_LABELS[key],
        status: activeStatus,
      }
    }

    return {
      key,
      label: STAGE_LABELS[key],
      status: 'pending',
    }
  })

const buildStagesForLocalUpload = (
  localUpload: LocalUploadItem,
  matchedUpload: IntakeUploadView | null,
  state: WorkflowCardState,
) => {
  if (state === 'selected') {
    return buildStageList(0, 'upload_received', 'active')
  }

  if (state === 'uploading') {
    if (localUpload.status === 'Requesting') {
      return buildStageList(0, 'upload_received', 'active')
    }

    return buildStageList(1, 'transfer_complete', 'active')
  }

  if (state === 'processing' && matchedUpload) {
    const activeStage = getActiveServerStage(matchedUpload)
    const activeStageIndex = STAGE_KEYS.indexOf(activeStage)
    return buildStageList(Math.max(activeStageIndex, 2), activeStage, 'active')
  }

  if (state === 'processing') {
    return buildStageList(2, 'detecting_pages', 'active')
  }

  if (state === 'completed') {
    return buildStageList(STAGE_KEYS.length, null, null)
  }

  if (state === 'needs_review') {
    return buildStageList(STAGE_KEYS.length - 1, 'complete', 'error')
  }

  if (state === 'failed') {
    const activeStage =
      matchedUpload?.currentStep || matchedUpload?.currentPhase
        ? getActiveServerStage(matchedUpload)
        : localUpload.progress > 0
          ? 'transfer_complete'
          : 'upload_received'
    const activeStageIndex = STAGE_KEYS.indexOf(activeStage)
    return buildStageList(Math.max(activeStageIndex, 0), activeStage, 'error')
  }

  return buildStageList(0, 'upload_received', 'active')
}

const buildStagesForServerUpload = (
  upload: IntakeUploadView,
  state: WorkflowCardState,
) => {
  if (state === 'completed') {
    return buildStageList(STAGE_KEYS.length, null, null)
  }

  if (state === 'needs_review') {
    return buildStageList(STAGE_KEYS.length - 1, 'complete', 'error')
  }

  if (state === 'failed') {
    const activeStage = getActiveServerStage(upload)
    const activeStageIndex = STAGE_KEYS.indexOf(activeStage)
    return buildStageList(Math.max(activeStageIndex, 2), activeStage, 'error')
  }

  if (state === 'processing') {
    const activeStage = getActiveServerStage(upload)
    const activeStageIndex = STAGE_KEYS.indexOf(activeStage)
    return buildStageList(Math.max(activeStageIndex, 2), activeStage, 'active')
  }

  return buildStageList(0, 'upload_received', 'active')
}

const getLocalDetailText = (
  localUpload: LocalUploadItem,
  matchedUpload: IntakeUploadView | null,
) => {
  switch (localUpload.status) {
    case 'Pending':
      return 'PDF selected and ready to upload.'
    case 'Requesting':
      return 'Preparing a secure upload destination.'
    case 'Uploading':
      return `Transferring PDF to storage (${Math.max(localUpload.progress, 1)}%).`
    case 'Queueing':
      return 'Transfer complete. Handing the file off for processing.'
    case 'Queued':
      return 'Upload completed. Waiting for worker pickup.'
    case 'Processing':
      return (
        humanizeToken(matchedUpload?.currentStep) ||
        humanizeToken(matchedUpload?.currentPhase) ||
        'Worker is detecting and validating the certificate.'
      )
    case 'Done':
      return 'Latest job finished successfully.'
    case 'Duplicate':
      return 'Latest job finished with items that need review.'
    case 'Error':
      return localUpload.error ?? 'The upload could not be completed.'
    default:
      return 'Ready to upload.'
  }
}

const getServerDetailText = (
  upload: IntakeUploadView,
  state: WorkflowCardState,
) => {
  if (state === 'completed') {
    return 'Latest job finished successfully.'
  }

  if (state === 'needs_review') {
    return 'Latest job finished with items that need review.'
  }

  if (state === 'failed') {
    return upload.errorMessage ?? 'Latest job did not finish successfully.'
  }

  if (state === 'processing') {
    return (
      humanizeToken(upload.currentStep) ||
      humanizeToken(upload.currentPhase) ||
      'Worker is detecting and validating the certificate.'
    )
  }

  return 'Select a PDF to begin a new intake run.'
}

const buildSummaryChips = (
  upload: IntakeUploadView | null,
  state: WorkflowCardState,
): { chips: Array<UploadSummaryChip>; fallbackLabel: string | null } => {
  const summary = upload?.resultSummary
  if (!summary) {
    return {
      chips: [],
      fallbackLabel:
        state === 'completed' || state === 'needs_review' || state === 'failed'
          ? 'Result summary will appear after validation data is available.'
          : null,
    }
  }

  const chips: Array<UploadSummaryChip> = []

  if (summary.detected !== null) {
    chips.push({
      label: 'certificate',
      value: summary.detected,
      tone: 'neutral',
    })
  }

  if (summary.validated !== null) {
    chips.push({
      label: 'validated',
      value: summary.validated,
      tone: 'success',
    })
  }

  if (
    (state === 'needs_review' || state === 'failed') &&
    summary.needsReview !== null
  ) {
    chips.push({
      label: 'need review',
      value: summary.needsReview,
      tone: 'warning',
    })
  } else if (summary.skipped !== null) {
    chips.push({
      label: 'skipped',
      value: summary.skipped,
      tone: 'neutral',
      placeholder: summary.source !== 'batch_summary',
    })
  }

  return {
    chips,
    fallbackLabel: null,
  }
}

const buildActions = (
  state: WorkflowCardState,
  uploadId: string | null,
): Array<CurrentUploadAction> => {
  switch (state) {
    case 'empty':
      return [
        {
          id: 'select_file',
          label: 'Upload PDF',
          variant: 'default',
        },
      ]
    case 'selected':
      return [
        {
          id: 'start_upload',
          label: 'Start upload',
          variant: 'default',
        },
        {
          id: 'select_file',
          label: 'Choose another file',
          variant: 'outline',
        },
      ]
    case 'uploading':
    case 'processing':
      return uploadId
        ? [
            {
              id: 'view_details',
              label: 'View details',
              variant: 'default',
            },
          ]
        : []
    case 'completed':
      return [
        {
          id: 'open_results',
          label: 'Open results',
          variant: 'default',
        },
        {
          id: 'select_file',
          label: 'Upload another PDF',
          variant: 'outline',
        },
        {
          id: 'view_details',
          label: 'View details',
          variant: 'ghost',
        },
      ]
    case 'needs_review':
      return [
        {
          id: 'review_issue',
          label: 'Review issue',
          variant: 'default',
        },
        {
          id: 'select_file',
          label: 'Upload another PDF',
          variant: 'outline',
        },
        {
          id: 'view_details',
          label: 'View details',
          variant: 'ghost',
        },
      ]
    case 'failed':
      return uploadId
        ? [
            {
              id: 'review_issue',
              label: 'Review issue',
              variant: 'default',
            },
            {
              id: 'select_file',
              label: 'Upload another PDF',
              variant: 'outline',
            },
            {
              id: 'view_details',
              label: 'View details',
              variant: 'ghost',
            },
          ]
        : [
            {
              id: 'retry',
              label: 'Retry upload',
              variant: 'default',
            },
            {
              id: 'select_file',
              label: 'Choose another file',
              variant: 'outline',
            },
          ]
    default:
      return []
  }
}

export const buildCurrentUploadCardModel = (input: {
  localUpload: LocalUploadItem | null
  recentUploads: Array<IntakeUploadView>
}): CurrentUploadCardModel => {
  const { localUpload, recentUploads } = input
  const latestUpload = recentUploads.at(0) ?? null

  if (localUpload === null && latestUpload === null) {
    return {
      state: 'empty',
      title: 'Current upload',
      fileName: null,
      sizeBytes: null,
      statusLabel: 'Pending',
      helperText:
        'Upload one PDF containing one BIR 2307 certificate to begin processing.',
      detailText:
        'We detect the certificate, ignore non-2307 pages, and save results only after full validation.',
      errorMessage: null,
      summaryChips: [],
      summaryFallbackLabel: null,
      stages: buildStageList(0, 'upload_received', 'active'),
      actions: buildActions('empty', null),
      uploadId: null,
      note: UPLOAD_NOTE,
    }
  }

  if (localUpload) {
    const matchedUpload = localUpload.uploadId
      ? (recentUploads.find((upload) => upload.id === localUpload.uploadId) ??
        null)
      : null
    const localState = normalizeLocalWorkflowState(localUpload)
    const state = resolveLocalCardState(localUpload, matchedUpload)
    const summary = buildSummaryChips(matchedUpload, state)

    return {
      state,
      title: 'Current upload',
      fileName: localUpload.file.name,
      sizeBytes: localUpload.file.size,
      statusLabel: toDisplayStatusLabel(state),
      helperText:
        state === 'completed'
          ? 'Latest job finished successfully.'
          : state === 'needs_review'
            ? 'Latest job needs review.'
            : state === 'failed'
              ? 'Current job needs attention.'
              : 'Current upload',
      detailText:
        matchedUpload && state !== localState
          ? getServerDetailText(matchedUpload, state)
          : getLocalDetailText(localUpload, matchedUpload),
      errorMessage:
        state === 'failed'
          ? (localUpload.error ?? matchedUpload?.errorMessage ?? null)
          : null,
      summaryChips: summary.chips,
      summaryFallbackLabel: summary.fallbackLabel,
      stages: buildStagesForLocalUpload(localUpload, matchedUpload, state),
      actions: buildActions(state, localUpload.uploadId),
      uploadId: localUpload.uploadId,
      note: UPLOAD_NOTE,
    }
  }

  const serverUpload = latestUpload as IntakeUploadView
  const state = normalizeServerWorkflowState(serverUpload)
  const summary = buildSummaryChips(serverUpload, state)

  return {
    state,
    title: 'Current upload',
    fileName: serverUpload.fileName,
    sizeBytes: serverUpload.sizeBytes,
    statusLabel: toDisplayStatusLabel(state),
    helperText:
      state === 'completed'
        ? 'Latest job finished successfully.'
        : state === 'needs_review'
          ? 'Latest job needs review.'
          : state === 'failed'
            ? 'Latest job needs attention.'
            : 'Current upload in progress.',
    detailText: getServerDetailText(serverUpload, state),
    errorMessage: state === 'failed' ? serverUpload.errorMessage : null,
    summaryChips: summary.chips,
    summaryFallbackLabel: summary.fallbackLabel,
    stages: buildStagesForServerUpload(serverUpload, state),
    actions: buildActions(state, serverUpload.id),
    uploadId: serverUpload.id,
    note: UPLOAD_NOTE,
  }
}

const toJobStatusFilter = (
  upload: IntakeUploadView,
): Exclude<JobsStatusFilter, 'all'> => {
  if (!hasOpenAttention(upload) && upload.overallStatus === 'duplicate') {
    return 'duplicate'
  }

  switch (upload.overallStatus) {
    case 'success':
    case 'completed':
      return 'completed'
    case 'duplicate':
      return 'needs_review'
    case 'error':
      return 'failed'
    case 'processing':
      return 'processing'
    default:
      return 'waiting'
  }
}

const toJobStatusLabel = (
  upload: IntakeUploadView,
  statusFilter: Exclude<JobsStatusFilter, 'all'>,
) => {
  if (!hasOpenAttention(upload)) {
    if (upload.overallStatus === 'duplicate') {
      return 'Duplicate'
    }

    if (upload.overallStatus === 'error') {
      return 'Failed'
    }
  }

  switch (statusFilter) {
    case 'completed':
      return 'Completed'
    case 'duplicate':
      return 'Duplicate'
    case 'needs_review':
      return 'Needs review'
    case 'failed':
      return 'Failed'
    case 'processing':
    case 'waiting':
      return 'Processing'
    default:
      return 'Pending'
  }
}

const toResultLabel = (upload: IntakeUploadView) => {
  const summary = upload.resultSummary
  if (!summary) {
    switch (upload.overallStatus) {
      case 'success':
      case 'completed':
        return 'Completed'
      case 'duplicate':
      case 'error':
        return 'Needs review'
      case 'processing':
      case 'queued':
      case 'uploaded':
        return 'Processing'
      default:
        return 'Pending'
    }
  }

  switch (upload.overallStatus) {
    case 'success':
    case 'completed':
      return 'Valid certificate'
    case 'processing':
    case 'queued':
    case 'uploaded':
      return 'Processing'
    case 'duplicate':
      return 'Duplicate certificate'
    case 'error':
      return 'Needs review'
    default:
      break
  }

  return 'Processing'
}

export const buildQueueMetrics = (
  summary: StatusSummary,
  _uploads: Array<IntakeUploadView> = [],
  _now = new Date(),
): Array<QueueMetric> => {
  return [
    {
      label: 'Waiting',
      value: summary.pending + summary.uploaded + summary.queued,
    },
    {
      label: 'Processing',
      value: summary.processing,
    },
    {
      label: 'Needs attention',
      value: summary.duplicate + summary.error,
    },
    {
      label: 'Completed',
      value: summary.success,
    },
  ]
}

export const buildNeedsAttentionItems = (
  uploads: Array<IntakeUploadView>,
): Array<NeedsAttentionItem> =>
  uploads
    .filter((upload) => hasOpenAttention(upload))
    .map((upload) => ({
      id: upload.id,
      fileName: upload.fileName,
      statusLabel:
        upload.overallStatus === 'duplicate' ? 'Needs review' : 'Failed',
      message:
        upload.errorMessage ??
        (upload.overallStatus === 'duplicate'
          ? 'Validation finished with duplicate or review flags.'
          : 'Upload requires manual review.'),
      actionLabel: 'Review issue',
    }))

const matchesJobsTab = (row: UploadJobRowModel, tab: JobsTab) => {
  if (tab === 'all') {
    return true
  }

  if (tab === 'processing') {
    return row.statusFilter === 'waiting' || row.statusFilter === 'processing'
  }

  if (tab === 'completed') {
    return row.statusFilter === 'completed'
  }

  return (
    row.hasOpenAttention &&
    (row.statusFilter === 'needs_review' || row.statusFilter === 'failed')
  )
}

export const buildJobsModel = (input: {
  uploads: Array<IntakeUploadView>
  activeTab: JobsTab
  statusFilter: JobsStatusFilter
  searchQuery: string
}): JobsModel => {
  const normalizedSearch = input.searchQuery.trim().toLowerCase()
  const rows = input.uploads.map<UploadJobRowModel>((upload) => {
    const statusFilter = toJobStatusFilter(upload)
    const statusLabel = toJobStatusLabel(upload, statusFilter)

    return {
      id: upload.id,
      fileName: upload.fileName,
      sizeBytes: upload.sizeBytes,
      resultLabel: toResultLabel(upload),
      statusLabel,
      statusFilter,
      hasOpenAttention: hasOpenAttention(upload),
      updatedAt: formatDate(getLatestActivity(upload)),
      actionLabel:
        statusFilter === 'completed'
          ? 'Open results'
          : (statusFilter === 'needs_review' || statusFilter === 'failed') &&
              hasOpenAttention(upload)
            ? 'Review issue'
            : 'View details',
      actionId:
        statusFilter === 'completed'
          ? 'open_results'
          : (statusFilter === 'needs_review' || statusFilter === 'failed') &&
              hasOpenAttention(upload)
            ? 'review_issue'
            : 'view_details',
      issueSummary: upload.errorMessage,
    }
  })

  const counts = {
    all: rows.length,
    processing: rows.filter((row) => matchesJobsTab(row, 'processing')).length,
    completed: rows.filter((row) => matchesJobsTab(row, 'completed')).length,
    needs_review: rows.filter((row) => matchesJobsTab(row, 'needs_review'))
      .length,
  }

  const filteredRows = rows.filter((row) => {
    if (!matchesJobsTab(row, input.activeTab)) {
      return false
    }

    if (
      input.statusFilter !== 'all' &&
      row.statusFilter !== input.statusFilter
    ) {
      return false
    }

    if (input.statusFilter === 'needs_review' && !row.hasOpenAttention) {
      return false
    }

    if (!normalizedSearch) {
      return true
    }

    return row.fileName.toLowerCase().includes(normalizedSearch)
  })

  return {
    rows: filteredRows,
    counts,
  }
}
