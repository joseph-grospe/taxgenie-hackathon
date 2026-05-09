export type IntakeUploadResultSummary = {
  detected: number | null
  validated: number | null
  skipped: number | null
  needsReview: number | null
  totalPages: number | null
  source: 'batch_summary' | 'results'
}

export type IntakeUploadView = {
  id: string
  batchId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadStatus: string
  queueStatus: string
  processingStatus: string
  overallStatus: string
  attentionStatus: 'open' | 'resolved'
  attentionResolvedAt: string | null
  removedFromBatchAt: string | null
  currentPhase: string | null
  currentStep: string | null
  errorMessage: string | null
  uploadedAt: string | null
  queuedAt: string | null
  processingStartedAt: string | null
  processingFinishedAt: string | null
  storageKey: string
  eventId: string | null
  revision: string | null
  resultSummary: IntakeUploadResultSummary | null
  worker: {
    jobId: string
    status: string
    currentPhase: string | null
    currentStep: string | null
    startedAt: string | null
    finishedAt: string | null
    errorSummary: string | null
  } | null
  result: {
    outcome: string
    status: string
    reasonCodes: Array<string>
    artifactKey: string | null
    finalKey: string | null
  } | null
}

export type StatusSummary = {
  pending: number
  uploaded: number
  queued: number
  processing: number
  success: number
  duplicate: number
  error: number
}

export type IntakeBatchView = {
  id: string
  name: string | null
  entity: {
    id: number
    shortName: string | null
    companyName: string | null
    tin: string | null
  } | null
  createdByUserId: string
  status: 'open' | 'closed'
  overallStatus: string
  canSignBatch: boolean
  batchSigningStatus: 'unavailable' | 'unsigned' | 'partial' | 'signed'
  totalFiles: number
  openAttentionCount: number
  counts: StatusSummary
  lastActivityAt: string | null
  closedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  files: Array<IntakeUploadView>
}

export type PresignedUpload = {
  batchId: string
  uploadId: string
  fileName: string
  sizeBytes: number
  mimeType: string
  storageKey: string
  method: 'PUT'
  url: string
  headers: Record<string, string>
}

export type PresignResponse = {
  batch: IntakeBatchView
  uploads: Array<PresignedUpload>
}

export type UploadEntityOption = {
  id: number
  shortName: string | null
  companyName: string | null
  tin: string
  tinPrefix: string
}

export type UploadEntitiesResponse = {
  entities: Array<UploadEntityOption>
}

export type RecentBatchesResponse = {
  activeBatch: IntakeBatchView | null
  recentBatches: Array<IntakeBatchView>
  summary: StatusSummary
}

export type BatchDetailResponse = {
  batch: IntakeBatchView | null
}

export type RemoveUploadResponse = {
  removedUploadId: string
  removedBatchId: string
  batchDeleted: boolean
}

export type LocalUploadStatus =
  | 'Pending'
  | 'Requesting'
  | 'Uploading'
  | 'Queueing'
  | 'Queued'
  | 'Processing'
  | 'Done'
  | 'Duplicate'
  | 'Error'

export type LocalUploadItem = {
  clientId: string
  file: File
  progress: number
  status: LocalUploadStatus
  error: string | null
  uploadId: string | null
  batchId: string | null
}
