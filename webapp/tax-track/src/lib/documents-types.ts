export type DocumentLogLevel = 'info' | 'warning' | 'error'

export type DocumentLogView = {
  timestamp: string
  level: DocumentLogLevel
  message: string
}

export type DocumentErrorView = {
  code: string
  stage: string
  message: string
}

export type DocumentValidationCheckView = {
  code: string
  passed: boolean
  message: string
}

export type DocumentReviewFieldView = {
  label: string
  value: string
  confidence: string
}

export type DocumentTrailStatus = 'complete' | 'active' | 'pending' | 'error'

export type DocumentTrailStepView = {
  label: string
  status: DocumentTrailStatus
  detail?: string
}

export type DocumentTrailDetailView = {
  label: string
  timestamp: string
  description: string
  status: DocumentTrailStatus
}

export type DocumentProcessingView = {
  startedAt?: string
  updatedAt?: string
  worker?: string
  elapsed?: string
}

export type RelatedDocumentView = {
  id: string
  label: string
  status: string
  pageNumber: number | null
}

export type DocumentBatchSummaryView = {
  totalPages: number
  certificatePageNumbers: Array<number>
  ignoredPageNumbers: Array<number>
  validPageNumbers: Array<number>
  failedPageNumbers: Array<number>
  duplicatePageNumbers: Array<number>
}

export type OperationalDocumentView = {
  id: string
  kind: 'upload' | 'certificate'
  uploadId: string
  attentionStatus?: 'open' | 'resolved'
  attentionResolvedAt?: string
  pageNumber: number | null
  fileName: string
  uploadedAt?: string
  sizeBytes?: number
  status: string
  stage: string
  nextStep: string
  payee: string
  period: string
  atc: string
  taxBase: string
  taxWithheld: string
  confidence: string
  year: string
  month: string
  quarter: string
  entity: string
  customerType: string
  errorTypes: Array<string>
  issueReason: string
  severity: string
  owner: string
  updatedAt: string
  processing?: DocumentProcessingView
  trail: Array<DocumentTrailStepView>
  trailDetails?: Array<DocumentTrailDetailView>
  logs: Array<DocumentLogView>
  errors: Array<DocumentErrorView>
  validationChecks: Array<DocumentValidationCheckView>
  reviewFields: Array<DocumentReviewFieldView>
  batchSummary?: DocumentBatchSummaryView
  relatedDocuments?: Array<RelatedDocumentView>
}
