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

export type DocumentSigningStatus = 'unsigned' | 'signed' | 'failed'

export type OperationalDocumentView = {
  id: string
  kind: 'upload' | 'certificate'
  uploadId: string
  uploadBatchId?: string
  attentionStatus?: 'open' | 'resolved'
  attentionResolvedAt?: string
  removedFromBatchAt?: string
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
  canSign: boolean
  signingStatus: DocumentSigningStatus
  signedAt?: string
  signedByName?: string
  signedPdfUrl?: string
  hasSavedTemplatePlacement: boolean
}
