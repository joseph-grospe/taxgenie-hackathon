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
  key?: string
  label: string
  rawValue?: string | number | boolean | null
  value: string
  confidence: string
  source?: 'original' | 'edited'
  originalValue?: string
  editedAt?: string
  editedByName?: string
}

export type DocumentExtractedFieldsEditView = {
  editedAt: string
  editedByName?: string
  editedFields: Array<string>
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

export type DocumentMergeAssignmentView = {
  packageType: 'quarterly' | 'annual'
  status: 'assigned' | 'manual_review'
  sourcePeriod: string
  sourceYear: number
  sourceQuarter: number | null
  assignedPeriod: string
  assignedYear: number | null
  assignedQuarter: number | null
  isLate: boolean
  reason: string
  updatedAt: string
}

export type DocumentOverrideView = {
  requestId: string
  status: 'pending' | 'approved' | 'rejected'
  requestNote: string
  requestedAt: string
  requestedByName: string
  decisionNote?: string
  decidedAt?: string
  decidedByName?: string
}

export type OperationalDocumentView = {
  id: string
  documentResultId?: number
  kind: 'upload' | 'certificate'
  uploadId: string
  uploadBatchId?: string
  removedFromBatchAt?: string
  fileName: string
  uploadedAt?: string
  sizeBytes?: number
  status: string
  stage: string
  nextStep: string
  payee: string
  payorName: string
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
  extractedFieldsEdit?: DocumentExtractedFieldsEditView | null
  canEditExtractedFields?: boolean
  canDownloadOriginalFile?: boolean
  canSign: boolean
  signingStatus: DocumentSigningStatus
  signedAt?: string
  signedByName?: string
  signedPdfUrl?: string
  hasSavedTemplatePlacement: boolean
  mergeAssignments?: Array<DocumentMergeAssignmentView>
  override?: DocumentOverrideView | null
  canRequestOverride?: boolean
}
