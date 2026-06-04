import { CheckCircle2Icon, Clock3Icon, MailIcon } from 'lucide-react'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { StatusPill, statusToneStyles } from '@/components/status-pill'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  getReconciliationCustomerEmailGroupKey,
  isPendingReconciliationCustomerEmailRow,
} from '@/lib/reconciliation-customer-groups'
import { formatDaysUncollected } from '@/lib/reconciliation-display'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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

function EmailSentStatus({
  emailSentAt,
  matchStatus,
}: {
  emailSentAt: string | null
  matchStatus: ReconciliationRowView['matchStatus']
}) {
  if (emailSentAt) {
    return (
      <div className="flex items-center gap-2 whitespace-nowrap">
        <Badge
          variant="outline"
          className={cn('w-fit', statusToneStyles.success)}
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

  if (matchStatus === 'matched') {
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <Badge variant="outline" className={cn('w-fit', statusToneStyles.warning)}>
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
  density?: 'default' | 'compact'
}

export function ReconciliationResultsTable({
  rows,
  selectedRowId = null,
  onRowSelect,
  onEmailRow,
  emailingCustomerGroupKey = null,
  emptyMessage = 'No reconciliation rows yet.',
  emptyDescription = 'Adjust the current filters or open a batch to import revenue data.',
  density = 'default',
}: ReconciliationResultsTableProps) {
  const isCompact = density === 'compact'
  const showEmailAction = Boolean(onEmailRow)

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-3 border border-dashed bg-muted/10 text-center',
          isCompact
            ? 'min-h-[180px] rounded-lg border-border/70 px-4'
            : 'min-h-[240px] rounded-[28px] border-border/60 px-8',
        )}
      >
        <p
          className={cn(
            'font-medium text-foreground',
            isCompact ? 'text-sm' : 'text-base',
          )}
        >
          {emptyMessage}
        </p>
        <p
          className={cn(
            'max-w-md text-muted-foreground',
            isCompact ? 'text-xs leading-5' : 'text-sm leading-6',
          )}
        >
          {emptyDescription}
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'min-h-0 overflow-auto border bg-background',
        isCompact
          ? 'rounded-lg border-border/70'
          : 'rounded-[28px] border-border/60',
      )}
    >
      <Table
        className={cn(
          isCompact && 'text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2',
        )}
      >
        <TableHeader
          className={cn(
            'sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:bg-muted/35 [&_th]:font-semibold [&_th]:uppercase [&_th]:text-muted-foreground',
            isCompact
              ? '[&_th]:h-8 [&_th]:text-[0.64rem] [&_th]:tracking-[0.08em]'
              : '[&_th]:h-11 [&_th]:text-[0.68rem] [&_th]:tracking-[0.16em]',
          )}
        >
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
            <TableHead className="text-right">
              No. of Days Uncollected
            </TableHead>
            <TableHead>Email Sent</TableHead>
            {showEmailAction ? (
              <TableHead className="text-right">Email Action</TableHead>
            ) : null}
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
                    ? cn(
                        'cursor-pointer odd:bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                        isCompact && 'hover:bg-muted/35',
                      )
                    : undefined
                }
              >
                <TableCell
                  className={cn(
                    'font-medium',
                    isCompact && 'max-w-48 truncate',
                  )}
                >
                  {row.customerName}
                </TableCell>
                <TableCell className={cn(isCompact && 'font-mono text-[11px]')}>
                  {formatTinForDisplay(row.tin) || '—'}
                </TableCell>
                <TableCell
                  className={cn(
                    'font-mono text-xs',
                    isCompact && 'text-[11px]',
                  )}
                >
                  {row.invoiceNumber}
                </TableCell>
                <TableCell>{row.accountingDate ?? '—'}</TableCell>
                <TableCell
                  className={cn(
                    'text-muted-foreground',
                    isCompact
                      ? 'max-w-56 truncate text-xs'
                      : 'max-w-72 whitespace-normal text-sm leading-6',
                  )}
                >
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
                <TableCell className="text-right">
                  {formatDaysUncollected(row.daysUncollected)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <EmailSentStatus
                    emailSentAt={row.emailSentAt}
                    matchStatus={row.matchStatus}
                  />
                </TableCell>
                {showEmailAction ? (
                  <TableCell className="text-right">
                    {isPendingReconciliationCustomerEmailRow(row) ? (
                      <AlertDialog>
                        <Tooltip>
                          <TooltipTrigger
                            render={<span className="inline-flex" />}
                          >
                            <AlertDialogTrigger
                              render={
                                <Button
                                  type="button"
                                  size="icon-xs"
                                  variant="outline"
                                  disabled={isEmailingCustomer}
                                  aria-label={`Send reconciliation email for customer ${row.customerName}`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                  }}
                                />
                              }
                            >
                              {isEmailingCustomer ? (
                                <Clock3Icon />
                              ) : (
                                <MailIcon />
                              )}
                            </AlertDialogTrigger>
                          </TooltipTrigger>
                          <TooltipContent>
                            {isEmailingCustomer
                              ? 'Sending email'
                              : 'Email customer'}
                          </TooltipContent>
                        </Tooltip>
                        <AlertDialogContent
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation()
                          }}
                        >
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Send reconciliation email?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {`This will email the customer about all pending unmatched reconciliation rows for ${row.customerName}.`}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={isEmailingCustomer}>
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              disabled={isEmailingCustomer}
                              onClick={(event) => {
                                event.stopPropagation()
                                onEmailRow?.(row)
                              }}
                            >
                              {isEmailingCustomer ? 'Sending...' : 'Send email'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
