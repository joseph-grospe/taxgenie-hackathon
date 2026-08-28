import { formatTinForDisplay } from '@taxgenie/shared/utils/tin'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { statusToneStyles } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { isPendingReconciliationCustomerEmailRow } from '@/lib/reconciliation-customer-groups'
import {
  formatDaysUncollected,
  formatReconciliationTimestamp,
} from '@/lib/reconciliation-display'
import { cn } from '@/lib/utils'

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const formatReconciliationAmount = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : NUMBER_FORMATTER.format(value)

export const getReconciliationDifferenceClassName = (
  value: number | null | undefined,
) => (value ? 'font-medium text-foreground' : 'text-muted-foreground')

export const getReconciliationComparisonRows = (row: ReconciliationRowView) => [
  {
    field: 'Taxable sales / Tax base',
    salesReport: formatReconciliationAmount(row.taxableSales),
    certificate: formatReconciliationAmount(row.taxBase),
    difference: formatReconciliationAmount(row.taxBaseDifference),
    differenceValue: row.taxBaseDifference,
  },
  {
    field: 'Prepaid CWT / Tax withheld',
    salesReport: formatReconciliationAmount(row.prepaidCWT),
    certificate: formatReconciliationAmount(row.taxWithheld),
    difference: formatReconciliationAmount(row.taxWithheldDifference),
    differenceValue: row.taxWithheldDifference,
  },
  {
    field: 'Output VAT',
    salesReport: formatReconciliationAmount(row.outputVAT),
    certificate: '—',
    difference: '—',
    differenceValue: null,
  },
]

export const getReconciliationVarianceSummary = (
  row: ReconciliationRowView,
) => {
  if (row.matchedCertificateId && row.hasDifference) {
    return 'Certificate attached, but variance remains open.'
  }

  if (row.matchStatus === 'unmatched') {
    return 'No matching certificate is attached to this sales report row.'
  }

  if (row.hasDifference) {
    return 'Certificate attached, but variance remains open.'
  }

  return 'Matched with no variance.'
}

export const getReconciliationOutreachSummary = (
  row: ReconciliationRowView,
) => {
  if (row.emailSentAt) {
    return `Email sent ${formatReconciliationTimestamp(row.emailSentAt)}.`
  }

  if (isPendingReconciliationCustomerEmailRow(row)) {
    return 'Pending outreach.'
  }

  if (row.matchStatus === 'matched') {
    return 'No outreach required.'
  }

  return 'Not eligible for outreach.'
}

export const getReconciliationEmailActionDescription = (
  row: ReconciliationRowView,
) => {
  if (isPendingReconciliationCustomerEmailRow(row)) {
    return 'Ready to email this customer group about open-variance rows.'
  }

  if (row.emailSentAt) {
    return getReconciliationOutreachSummary(row)
  }

  if (row.matchStatus === 'matched') {
    return 'Matched rows do not need customer outreach.'
  }

  if (!row.hasDifference) {
    return 'Rows without a variance do not need customer outreach.'
  }

  return 'Email is available only for open-variance rows.'
}

export const getReconciliationTinDisplay = (row: ReconciliationRowView) =>
  formatTinForDisplay(row.tin) || '—'

export const getReconciliationMatchedTaxRecordDisplay = (
  row: ReconciliationRowView,
) => (row.matchedCertificateId ? String(row.matchedCertificateId) : '—')

export function ReconciliationDetailField({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={cn('grid gap-1', className)}>
      <dt className="text-[0.68rem] font-medium uppercase tracking-normal text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 text-sm text-foreground">{value}</dd>
    </div>
  )
}

export function ReconciliationComparisonTable({
  row,
  className,
  tableClassName,
}: {
  row: ReconciliationRowView
  className?: string
  tableClassName?: string
}) {
  const comparisonRows = getReconciliationComparisonRows(row)

  return (
    <div className={cn('overflow-x-auto', className)}>
      <Table
        className={cn(
          'text-xs [&_td]:px-4 [&_td]:py-2.5 [&_th]:px-4',
          tableClassName,
        )}
      >
        <TableHeader className="[&_th]:h-8 [&_th]:bg-muted/35 [&_th]:text-[0.68rem] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-normal [&_th]:text-muted-foreground">
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead className="text-right">Sales report</TableHead>
            <TableHead className="text-right">Certificate</TableHead>
            <TableHead className="text-right">Difference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {comparisonRows.map((item) => (
            <TableRow key={item.field}>
              <TableCell className="font-medium">{item.field}</TableCell>
              <TableCell className="text-right tabular-nums">
                {item.salesReport}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {item.certificate}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right tabular-nums',
                  getReconciliationDifferenceClassName(item.differenceValue),
                )}
              >
                {item.difference}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function ReconciliationVarianceBadge({
  row,
}: {
  row: ReconciliationRowView
}) {
  return (
    <Badge
      variant="outline"
      className={
        row.hasDifference ? statusToneStyles.warning : statusToneStyles.success
      }
    >
      {row.hasDifference ? 'Variance' : 'Clear'}
    </Badge>
  )
}

export const getReconciliationDaysUncollectedDisplay = (
  row: ReconciliationRowView,
) => formatDaysUncollected(row.daysUncollected)

export const getReconciliationTimestampDisplay = (value: string | null) =>
  formatReconciliationTimestamp(value)
