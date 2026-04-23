import { CheckCircle2Icon, Clock3Icon, MailIcon } from 'lucide-react'

import { StatusPill } from '@/components/status-pill'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ReconciliationRowView } from '@/lib/reconciliation-types'
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
  onRowSelect?: (row: ReconciliationRowView) => void
  onEmailRow?: (row: ReconciliationRowView) => void
  emailingRowId?: number | null
  emptyMessage?: string
}

export function ReconciliationResultsTable({
  rows,
  onRowSelect,
  onEmailRow,
  emailingRowId = null,
  emptyMessage = 'No reconciliation rows yet.',
}: ReconciliationResultsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="min-h-0 overflow-auto rounded-xl border border-border/60">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
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
            <TableHead className="text-right">
              Tax Base (Certificate)
            </TableHead>
            <TableHead className="text-right">
              Tax Withheld (Certificate)
            </TableHead>
            <TableHead className="text-right">Tax Base Difference</TableHead>
            <TableHead className="text-right">Tax Withheld Difference</TableHead>
            <TableHead>Match Status</TableHead>
            <TableHead>Email Sent</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              tabIndex={0}
              onClick={() => onRowSelect?.(row)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onRowSelect?.(row)
                }
              }}
              className={
                onRowSelect
                  ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                  : undefined
              }
            >
              <TableCell className="font-medium">{row.customerName}</TableCell>
              <TableCell>{row.tin}</TableCell>
              <TableCell>{row.invoiceNumber}</TableCell>
              <TableCell>{row.accountingDate ?? '—'}</TableCell>
              <TableCell className="max-w-72 truncate">
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
                {row.hasDifference &&
                row.matchStatus === 'unmatched' &&
                !row.emailSentAt ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="size-8 p-0"
                    disabled={emailingRowId === row.id}
                    aria-label={`Send reconciliation email for invoice ${row.invoiceNumber}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onEmailRow?.(row)
                    }}
                  >
                    <MailIcon className="size-4" />
                    <span className="sr-only">
                      {emailingRowId === row.id ? 'Sending...' : 'Email'}
                    </span>
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
