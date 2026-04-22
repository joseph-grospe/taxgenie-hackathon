export type ReconciliationMatchStatus = 'matched' | 'unmatched'

export type ReconciliationRowView = {
  id: number
  uploadBatchId: string
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
  matchedTaxRecordId: number | null
  taxBase: number | null
  taxWithheld: number | null
  taxBaseDifference: number
  taxWithheldDifference: number
  hasDifference: boolean
  matchStatus: ReconciliationMatchStatus
  emailSentAt: string | null
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
}
