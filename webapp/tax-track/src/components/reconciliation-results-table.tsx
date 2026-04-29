import { CheckCircle2Icon, Clock3Icon, MailIcon } from 'lucide-react'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { StatusPill } from '@/components/status-pill'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  getReconciliationCustomerEmailGroupKey,
  isPendingReconciliationCustomerEmailRow,
} from '@/lib/reconciliation-customer-groups'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatAmount = (value: number | null) =>
  value === null ? '—' : NUMBER_FORMATTER.format(value)

const getDifferenceTextClassName = (value: number | null) => {
  if (value === null || value === 0) {
    return 'text-muted-foreground'
  }

  return value > 0 ? 'font-medium text-rose-700' : 'font-medium text-amber-700'
}

const formatEmailSentDate = (emailSentAt: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(emailSentAt))

function EmailSentStatus({ emailSentAt }: { emailSentAt: string | null }) {
  if (emailSentAt) {
    return (
      <div className="flex flex-col gap-1">
        <Badge
          variant="outline"
          className="w-fit border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
        >
          <CheckCircle2Icon />
          Sent
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatEmailSentDate(emailSentAt)}
        </span>
      </div>
    )
  }

  return (
    <Badge
      variant="outline"
      className="w-fit border-slate-500/30 bg-slate-500/10 text-slate-600"
    >
      <Clock3Icon />
      Pending
    </Badge>
  )
}

type ReconciliationResultsTableProps = {
  rows: Array<ReconciliationRowView>
  selectedRowId?: number | null
  onRowSelect?: (row: ReconciliationRowView) => void
  onEmailRow?: (row: ReconciliationRowView) => void
  emailingCustomerGroupKey?: string | null
  emptyMessage?: string
  emptyDescription?: string
}

export function ReconciliationResultsTable({
  rows,
  selectedRowId = null,
  onRowSelect,
  onEmailRow,
  emailingCustomerGroupKey = null,
  emptyMessage = 'No reconciliation rows yet.',
  emptyDescription = 'Adjust the current filters or open a batch to import revenue data.',
}: ReconciliationResultsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-border/60 bg-muted/10 px-8 text-center">
        <p className="text-base font-medium text-foreground">{emptyMessage}</p>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          {emptyDescription}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 overflow-auto rounded-[28px] border border-border/60 bg-background">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:h-11 [&_th]:bg-muted/35 [&_th]:text-[0.68rem] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.16em] [&_th]:text-muted-foreground">
          <TableRow>
            <TableHead>Customer Name</TableHead>
            <TableHead>TIN</TableHead>
            <TableHead>Invoice Number</TableHead>
            <TableHead>Accounting Date</TableHead>
            <TableHead>Transaction Line Description</TableHead>
            <TableHead className="text-right">
              Taxable Sales (Sales Report)
            </TableHead>
            <TableHead className="text-right">Output VAT</TableHead>
            <TableHead className="text-right">
              Prepaid CWT (Sales Report)
            </TableHead>
            <TableHead className="text-right">Tax Base (Certificate)</TableHead>
            <TableHead className="text-right">
              Tax Withheld (Certificate)
            </TableHead>
            <TableHead className="text-right">Tax Base Difference</TableHead>
            <TableHead className="text-right">
              Tax Withheld Difference
            </TableHead>
            <TableHead>Match Status</TableHead>
            <TableHead>Email Sent</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const customerGroupKey = getReconciliationCustomerEmailGroupKey(row)
            const isEmailingCustomer =
              emailingCustomerGroupKey === customerGroupKey

            return (
              <TableRow
                key={row.id}
                tabIndex={0}
                data-state={selectedRowId === row.id ? 'selected' : undefined}
                onClick={() => onRowSelect?.(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onRowSelect?.(row)
                  }
                }}
                className={
                  onRowSelect
                    ? 'cursor-pointer odd:bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                    : undefined
                }
              >
              <TableCell className="font-medium">{row.customerName}</TableCell>
              <TableCell>{row.tin}</TableCell>
              <TableCell className="font-mono text-xs">
                {row.invoiceNumber}
              </TableCell>
              <TableCell>{row.accountingDate ?? '—'}</TableCell>
              <TableCell className="max-w-72 whitespace-normal text-sm leading-6 text-muted-foreground">
                {row.transactionLineDescription}
              </TableCell>
              <TableCell className="text-right">
                {formatAmount(row.taxableSales)}
              </TableCell>
              <TableCell className="text-right">
                {formatAmount(row.outputVAT)}
              </TableCell>
              <TableCell className="text-right">
                {formatAmount(row.prepaidCWT)}
              </TableCell>
              <TableCell className="text-right">
                {formatAmount(row.taxBase)}
              </TableCell>
              <TableCell className="text-right">
                {formatAmount(row.taxWithheld)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right',
                  getDifferenceTextClassName(row.taxBaseDifference),
                )}
              >
                {formatAmount(row.taxBaseDifference)}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right',
                  getDifferenceTextClassName(row.taxWithheldDifference),
                )}
              >
                {formatAmount(row.taxWithheldDifference)}
              </TableCell>
              <TableCell>
                <StatusPill status={row.matchStatus} />
              </TableCell>
              <TableCell>
                <EmailSentStatus emailSentAt={row.emailSentAt} />
              </TableCell>
              <TableCell className="text-right">
                {isPendingReconciliationCustomerEmailRow(row) ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="rounded-full"
                    disabled={isEmailingCustomer}
                    aria-label={`Send reconciliation email for customer ${row.customerName}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onEmailRow?.(row)
                    }}
                  >
                    <MailIcon />
                    <span className="sr-only">
                      {isEmailingCustomer
                        ? 'Sending customer email...'
                        : 'Email customer'}
                    </span>
                  </Button>
                ) : null}
              </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
