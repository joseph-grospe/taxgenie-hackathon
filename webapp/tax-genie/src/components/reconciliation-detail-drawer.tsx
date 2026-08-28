import {
  IconExternalLink,
  IconLoader2,
  IconMail,
  IconX,
} from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { StatusPill, statusToneStyles } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  ReconciliationComparisonTable,
  ReconciliationDetailField,
  ReconciliationVarianceBadge,
  getReconciliationDaysUncollectedDisplay,
  getReconciliationMatchedTaxRecordDisplay,
  getReconciliationOutreachSummary,
  getReconciliationTimestampDisplay,
  getReconciliationTinDisplay,
  getReconciliationVarianceSummary,
} from '@/components/reconciliation-row-detail'
import {
  getReconciliationCustomerEmailGroupKey,
  isPendingReconciliationCustomerEmailRow,
} from '@/lib/reconciliation-customer-groups'
import { defaultReconciliationSearch } from '@/lib/reconciliation-search-state'

type ReconciliationDetailDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: ReconciliationRowView
  onEmailRow?: (row: ReconciliationRowView) => void
  emailingCustomerGroupKey?: string | null
}

export function ReconciliationDetailDrawer({
  open,
  onOpenChange,
  row,
  onEmailRow,
  emailingCustomerGroupKey = null,
}: ReconciliationDetailDrawerProps) {
  const rowEmailGroupKey = getReconciliationCustomerEmailGroupKey(row)
  const canSendEmail = Boolean(onEmailRow)
  const isEmailEligible =
    canSendEmail && isPendingReconciliationCustomerEmailRow(row)
  const isEmailingCustomer = emailingCustomerGroupKey === rowEmailGroupKey
  const isEmailDisabled = !isEmailEligible || isEmailingCustomer

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="max-h-screen overflow-hidden data-[vaul-drawer-direction=right]:w-[min(92vw,760px)] data-[vaul-drawer-direction=right]:sm:max-w-none">
        <DrawerHeader className="flex-row items-start justify-between gap-4 border-b border-border/60 px-6 py-5 text-left">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusPill status={row.matchStatus} />
              <Badge variant="outline" className={statusToneStyles.neutral}>
                {row.invoiceNumber}
              </Badge>
            </div>
            <DrawerTitle className="truncate text-base">
              {row.customerName}
            </DrawerTitle>
            <DrawerDescription>
              Active reconciliation row comparison
            </DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button size="icon" variant="ghost" aria-label="Close drawer">
              <IconX />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-4">
            <section className="rounded-lg border border-border/60 bg-muted/20 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Identity</h3>
                <Badge variant="outline" className={statusToneStyles.neutral}>
                  {row.derivedBillingMonthMMYY}
                </Badge>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                <ReconciliationDetailField
                  label="TIN"
                  value={getReconciliationTinDisplay(row)}
                />
                <ReconciliationDetailField
                  label="Requesting entity"
                  value={row.requestingEntityShortName ?? '—'}
                />
                <ReconciliationDetailField
                  label="Derived billing month"
                  value={row.derivedBillingMonthMMYY}
                />
                <ReconciliationDetailField
                  label="Accounting date"
                  value={row.accountingDate ?? '—'}
                />
                <ReconciliationDetailField
                  label="Issuer shortname"
                  value={row.issuerShortnameUsedForMatch || '—'}
                />
                <ReconciliationDetailField
                  label="Matched tax record"
                  value={getReconciliationMatchedTaxRecordDisplay(row)}
                />
                <ReconciliationDetailField
                  label="Transaction line"
                  value={row.transactionLineDescription || '—'}
                  className="sm:col-span-2"
                />
              </dl>
            </section>

            <section className="rounded-lg border border-border/60 bg-background">
              <div className="border-b border-border/60 px-4 py-3">
                <h3 className="text-sm font-semibold">
                  Sales report vs Certificate
                </h3>
              </div>
              <ReconciliationComparisonTable row={row} />
            </section>

            <section className="rounded-lg border border-border/60 bg-muted/20 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Variance and outreach</h3>
                <ReconciliationVarianceBadge row={row} />
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                <ReconciliationDetailField
                  label="Variance"
                  value={getReconciliationVarianceSummary(row)}
                  className="sm:col-span-2"
                />
                <ReconciliationDetailField
                  label="Outreach"
                  value={getReconciliationOutreachSummary(row)}
                  className="sm:col-span-2"
                />
                <ReconciliationDetailField
                  label="Matched at"
                  value={getReconciliationTimestampDisplay(row.matchedAt)}
                />
                <ReconciliationDetailField
                  label="Email sent"
                  value={getReconciliationTimestampDisplay(row.emailSentAt)}
                />
                <ReconciliationDetailField
                  label="Days uncollected"
                  value={getReconciliationDaysUncollectedDisplay(row)}
                />
                <ReconciliationDetailField
                  label="Updated"
                  value={getReconciliationTimestampDisplay(row.updatedAt)}
                />
              </dl>
            </section>
          </div>
        </div>

        <DrawerFooter className="shrink-0 flex-row justify-end border-t border-border/60 bg-background px-6 py-4">
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
            onClick={() => onEmailRow?.(row)}
          >
            {isEmailingCustomer ? (
              <IconLoader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <IconMail data-icon="inline-start" />
            )}
            {isEmailingCustomer ? 'Sending...' : 'Email customer'}
          </Button>

          <Button
            type="button"
            nativeButton={false}
            render={
              <Link
                to="/reconciliation/$rowId"
                params={{ rowId: String(row.id) }}
                search={defaultReconciliationSearch}
                onClick={() => onOpenChange(false)}
              />
            }
          >
            <IconExternalLink data-icon="inline-start" />
            Open full view
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
