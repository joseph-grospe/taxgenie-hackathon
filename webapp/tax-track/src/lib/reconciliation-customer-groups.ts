import type { ReconciliationRowView } from '@/lib/reconciliation-types'

export const isPendingReconciliationCustomerEmailRow = (
  row: ReconciliationRowView,
) =>
  Boolean(getReconciliationCustomerEmailScope(row)) &&
  row.matchStatus === 'unmatched' &&
  row.hasDifference &&
  !row.emailSentAt

const getReconciliationCustomerEmailScope = (
  row: Pick<
    ReconciliationRowView,
    'uploadBatchId' | 'salesReportRunId' | 'salesReportId'
  >,
) => {
  if (row.uploadBatchId) {
    return `batch:${row.uploadBatchId}`
  }

  if (row.salesReportRunId) {
    return `sales-report-run:${row.salesReportRunId}`
  }

  if (row.salesReportId) {
    return `sales-report:${row.salesReportId}`
  }

  return null
}

export const getReconciliationCustomerEmailGroupKey = (
  row: Pick<
    ReconciliationRowView,
    | 'uploadBatchId'
    | 'salesReportRunId'
    | 'salesReportId'
    | 'customerName'
    | 'tin'
    | 'requestingEntityShortName'
  >,
) =>
  JSON.stringify([
    getReconciliationCustomerEmailScope(row),
    row.customerName,
    row.tin,
    row.requestingEntityShortName ?? '',
  ])

export const countPendingReconciliationCustomerEmailGroups = (
  rows: Array<ReconciliationRowView>,
) =>
  new Set(
    rows
      .filter(isPendingReconciliationCustomerEmailRow)
      .map(getReconciliationCustomerEmailGroupKey),
  ).size
