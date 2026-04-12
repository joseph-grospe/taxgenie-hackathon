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

export type DocumentTrailStatus = 'complete' | 'active' | 'pending' | 'error'

export type DocumentTrailStepView = {
  label: string
  status: DocumentTrailStatus
  detail?: string
}

export type DocumentProcessingView = {
  startedAt?: string
  updatedAt?: string
  worker?: string
  elapsed?: string
}

export type OperationalDocumentView = {
  id: string
  batchId: string
  fileName: string
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
  logs: Array<DocumentLogView>
  errors: Array<DocumentErrorView>
}
