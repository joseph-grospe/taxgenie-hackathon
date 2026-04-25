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
  fileName: string
  mimeType: string
  sizeBytes: number
  uploadStatus: string
  queueStatus: string
  processingStatus: string
  overallStatus: string
  attentionStatus: 'open' | 'resolved'
  attentionResolvedAt: string | null
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

export type PresignedUpload = {
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
  upload: PresignedUpload
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
}
