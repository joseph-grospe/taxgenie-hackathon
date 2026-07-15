import { IconLoader2, IconMail } from '@tabler/icons-react'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import {
  ReconciliationComparisonTable,
  ReconciliationDetailField,
  ReconciliationVarianceBadge,
  getReconciliationDaysUncollectedDisplay,
  getReconciliationEmailActionDescription,
  getReconciliationMatchedTaxRecordDisplay,
  getReconciliationOutreachSummary,
  getReconciliationTimestampDisplay,
  getReconciliationTinDisplay,
  getReconciliationVarianceSummary,
} from '@/components/reconciliation-row-detail'
import { StatusPill, statusToneStyles } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { isPendingReconciliationCustomerEmailRow } from '@/lib/reconciliation-customer-groups'

type ReconciliationRowPageProps = {
  row: ReconciliationRowView
  canSendEmail?: boolean
  isSendingEmail?: boolean
  onEmailRow: (row: ReconciliationRowView) => void
}

export function ReconciliationRowPage({
  row,
  canSendEmail = true,
  isSendingEmail = false,
  onEmailRow,
}: ReconciliationRowPageProps) {
  const isEmailEligible =
    canSendEmail && isPendingReconciliationCustomerEmailRow(row)
  const isEmailDisabled = !isEmailEligible || isSendingEmail

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-border/60 bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusPill status={row.matchStatus} />
              <Badge variant="outline" className={statusToneStyles.neutral}>
                {row.invoiceNumber}
              </Badge>
            </div>
            <h2 className="truncate text-xl font-semibold tracking-normal text-foreground">
              {row.customerName}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Case file for one active reconciliation result.
            </p>
          </div>

          <dl className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3 lg:max-w-3xl">
            <ReconciliationDetailField
              label="TIN"
              value={getReconciliationTinDisplay(row)}
            />
            <ReconciliationDetailField
              label="Billing month"
              value={row.derivedBillingMonthMMYY}
            />
            <ReconciliationDetailField
              label="Requesting entity"
              value={row.requestingEntityShortName ?? '—'}
            />
          </dl>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="grid gap-4">
          <section className="rounded-lg border border-border/60 bg-background">
            <div className="border-b border-border/60 px-4 py-3">
              <h3 className="text-sm font-semibold">
                Sales report vs Certificate
              </h3>
            </div>
            <ReconciliationComparisonTable row={row} tableClassName="text-sm" />
          </section>

          <section className="rounded-lg border border-border/60 bg-muted/20 p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold">Match context</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Source fields and timestamps used for audit review.
              </p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <ReconciliationDetailField
                label="Transaction line"
                value={row.transactionLineDescription || '—'}
                className="sm:col-span-2"
              />
              <ReconciliationDetailField
                label="Issuer shortname"
                value={row.issuerShortnameUsedForMatch || '—'}
              />
              <ReconciliationDetailField
                label="Accounting date"
                value={row.accountingDate ?? '—'}
              />
              <ReconciliationDetailField
                label="Matched tax record"
                value={getReconciliationMatchedTaxRecordDisplay(row)}
              />
              <ReconciliationDetailField
                label="Matched at"
                value={getReconciliationTimestampDisplay(row.matchedAt)}
              />
              <ReconciliationDetailField
                label="Updated"
                value={getReconciliationTimestampDisplay(row.updatedAt)}
              />
            </dl>
          </section>
        </div>

        <section className="rounded-lg border border-border/60 bg-muted/20 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Variance and outreach</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Customer follow-up state for this row.
              </p>
            </div>
            <ReconciliationVarianceBadge row={row} />
          </div>

          <dl className="grid gap-3">
            <ReconciliationDetailField
              label="Variance"
              value={getReconciliationVarianceSummary(row)}
            />
            <ReconciliationDetailField
              label="Email state"
              value={getReconciliationOutreachSummary(row)}
            />
            <ReconciliationDetailField
              label="Days uncollected"
              value={getReconciliationDaysUncollectedDisplay(row)}
            />
            <ReconciliationDetailField
              label="Email sent"
              value={getReconciliationTimestampDisplay(row.emailSentAt)}
            />
          </dl>

          <div className="mt-5 rounded-md border border-border/60 bg-background p-3">
            <div className="mb-3">
              <p className="text-[0.68rem] font-medium uppercase tracking-normal text-muted-foreground">
                Row action
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {getReconciliationEmailActionDescription(row)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={isEmailDisabled}
              title={
                isEmailEligible
                  ? 'Preview email'
                  : canSendEmail
                    ? 'Email is available only for open-variance rows.'
                    : 'Only operational users can send customer emails.'
              }
              onClick={() => onEmailRow(row)}
            >
              {isSendingEmail ? (
                <IconLoader2
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <IconMail data-icon="inline-start" />
              )}
              {isSendingEmail ? 'Sending...' : 'Email customer'}
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
