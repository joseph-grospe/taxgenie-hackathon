import type { ReconciliationRowView } from '@/lib/reconciliation-types'

export const isPendingReconciliationCustomerEmailRow = (
  row: ReconciliationRowView,
) => row.matchStatus === 'unmatched' && row.hasDifference && !row.emailSentAt

export const getReconciliationCustomerEmailGroupKey = (
  row: Pick<
    ReconciliationRowView,
    'uploadBatchId' | 'customerName' | 'tin' | 'requestingEntityShortName'
  >,
) =>
  JSON.stringify([
    row.uploadBatchId,
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
