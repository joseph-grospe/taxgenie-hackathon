export type ReconciliationEmailPreviewRow = {
  shortName: string | null
  tin: string | null
  customerName: string | null
  invoiceNumber: string | null
  billingMonthMMYY: string
  accountingDate: string | null
  taxableSales: number | null
  prepaidCWT: number | null
  collectedTaxBase: number | null
  collectedPrepaidCWT: number | null
  taxBaseDifference: number | null
  prepaidCWTDifference: number | null
}

export type ReconciliationEmailPreviewPayload = {
  to: Array<string>
  cc: Array<string>
  subject: string
  body: string
  customerName: string
  attachmentFileName: string
  rowCount: number
  rows: Array<ReconciliationEmailPreviewRow>
}
