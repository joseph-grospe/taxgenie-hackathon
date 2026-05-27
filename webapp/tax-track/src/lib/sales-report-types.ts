import type { ReconciliationListView } from '@/lib/reconciliation-types'
import type { BatchListPagination } from '@/lib/upload-intake-types'

export type SalesReportStatus = 'uploading' | 'ready' | 'error' | 'deleted'
export type SalesReportVersionStatus = 'pending' | 'ready' | 'error'
export type SalesReportRunStatus = 'running' | 'completed' | 'failed' | 'archived'

export type SalesReportEntitySnapshot = {
  id: number
  shortName: string | null
  companyName: string | null
  tin: string
}

export type SalesReportVersionView = {
  id: string
  salesReportId: string
  versionNumber: number
  originalFileName: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  parseStatus: SalesReportVersionStatus
  rowCount: number
  errorMessage: string | null
  uploadedAt: string | null
  parsedAt: string | null
  createdAt: string
  updatedAt: string
}

export type SalesReportRowView = {
  id: number
  rowNumber: number
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
}

export type SalesReportRunBatchView = {
  batchId: string
  name: string | null
  entityName: string
  totalFiles: number
  createdAt: string | null
  closedAt: string | null
}

export type SalesReportRunView = {
  id: string
  salesReportId: string
  salesReportVersionId: string
  status: SalesReportRunStatus
  selectedBatchCount: number
  totalRows: number
  matchedCount: number
  unmatchedCount: number
  varianceTotal: number
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  batches: Array<SalesReportRunBatchView>
}

export type SalesReportListItem = {
  id: string
  name: string
  status: SalesReportStatus
  entity: SalesReportEntitySnapshot
  currentVersion: SalesReportVersionView | null
  latestRun: SalesReportRunView | null
  createdAt: string
  updatedAt: string
}

export type SalesReportListResponse = {
  reports: Array<SalesReportListItem>
  pagination: BatchListPagination
  summary: {
    total: number
    ready: number
    error: number
    uploading: number
  }
}

export type SalesReportDetailView = SalesReportListItem & {
  rows: Array<SalesReportRowView>
  rowsPagination: BatchListPagination
  runs: Array<SalesReportRunView>
  activeReconciliation: ReconciliationListView
}

export type SalesReportPresignedUpload = {
  reportId: string
  versionId: string
  fileName: string
  sizeBytes: number
  mimeType: string
  storageKey: string
  method: 'PUT'
  url: string
  headers: Record<string, string>
}

export type SalesReportPresignResponse = {
  report: SalesReportListItem
  upload: SalesReportPresignedUpload
}
