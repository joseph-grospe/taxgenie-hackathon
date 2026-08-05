export type ReconciliationMatchStatus = 'matched' | 'unmatched'

export type ReconciliationRowView = {
  id: number
  uploadBatchId: string | null
  salesReportId?: string | null
  salesReportVersionId?: string | null
  salesReportRunId?: string | null
  salesReportRowId?: number | null
  matchedUploadBatchId?: string | null
  requestingEntityShortName: string | null
  customerName: string
  tin: string
  invoiceNumber: string
  accountingDate: string | null
  transactionLineDescription: string
  taxableSales: number
  outputVAT: number
  prepaidCWT: number
  issuerShortnameUsedForMatch: string
  derivedBillingMonthMMYY: string
  matchedCertificateId: number | null
  taxBase: number | null
  taxWithheld: number | null
  taxBaseDifference: number
  taxWithheldDifference: number
  hasDifference: boolean
  matchStatus: ReconciliationMatchStatus
  matchedAt: string | null
  emailSentAt: string | null
  archivedAt?: string | null
  daysUncollected: number | null
  createdAt: string
  updatedAt: string
}

export type ReconciliationSummaryView = {
  totalRecords: number
  matched: number
  unmatched: number
  varianceTotal: number
}

export type ReconciliationListView = {
  rows: Array<ReconciliationRowView>
  summary: ReconciliationSummaryView
  pagination?: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
}
