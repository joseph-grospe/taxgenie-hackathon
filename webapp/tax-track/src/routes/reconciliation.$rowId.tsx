import { Link, createFileRoute } from '@tanstack/react-router'
import { IconArrowLeft, IconChecklist } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { AppShell } from '@/components/app-shell'
import { StatusPill, formatStatusLabel } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export const Route = createFileRoute('/reconciliation/$rowId')({
  component: RouteComponent,
})

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatAmount = (value: number | null) =>
  value === null ? '—' : NUMBER_FORMATTER.format(value)

const formatEmailSentStatus = (emailSentAt: string | null) =>
  emailSentAt ? 'Sent' : 'Not Sent'

function RouteComponent() {
  const { rowId } = Route.useParams()
  const [row, setRow] = useState<ReconciliationRowView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  const loadRow = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/reconciliation/${rowId}`, {
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => null)) as
        | { row?: ReconciliationRowView; error?: string }
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load reconciliation detail (${response.status}).`,
        )
      }

      setRow(payload?.row ?? null)
      setLoadError(null)
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load reconciliation detail.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [rowId])

  useEffect(() => {
    void loadRow()
  }, [loadRow])

  const handleSendEmail = useCallback(async () => {
    setIsSendingEmail(true)
    setEmailError(null)

    try {
      const response = await fetch(`/api/reconciliation/${rowId}`, {
        method: 'POST',
      })
      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string
            error?: string
            to?: Array<string>
            cc?: Array<string>
            customerName?: string
            sentRowCount?: number
            sentRowIds?: Array<number>
          }
        | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to send reconciliation email (${response.status}).`,
        )
      }

      await loadRow()
      toast.success('Email sent successfully', {
        description: payload?.message ?? 'Reconciliation email sent.',
      })
    } catch (error) {
      setEmailError(
        error instanceof Error
          ? error.message
          : 'Unable to send reconciliation email.',
      )
    } finally {
      setIsSendingEmail(false)
    }
  }, [loadRow, rowId])

  if (isLoading) {
    return (
      <AppShell
        title="Reconciliation Detail"
        subtitle={rowId}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link to="/reconciliation" className="flex items-center gap-2">
              <IconArrowLeft className="size-4" />
              Back
            </Link>
          </Button>
        }
      >
        <Card>
          <CardHeader>
            <CardTitle>Loading row</CardTitle>
            <CardDescription>Fetching reconciliation detail...</CardDescription>
          </CardHeader>
        </Card>
      </AppShell>
    )
  }

  if (!row) {
    return (
      <AppShell
        title="Reconciliation Detail"
        subtitle={rowId}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link to="/reconciliation" className="flex items-center gap-2">
              <IconArrowLeft className="size-4" />
              Back
            </Link>
          </Button>
        }
      >
        <Card>
          <CardHeader>
            <CardTitle>Row not found</CardTitle>
            <CardDescription>
              {loadError ??
                'This reconciliation row may have been removed or the link is invalid.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </AppShell>
    )
  }

  const status = formatStatusLabel(row.matchStatus)

  return (
    <AppShell
      title="Reconciliation Detail"
      subtitle={String(row.id)}
      actions={
        <Button size="sm" variant="outline" asChild>
          <Link to="/reconciliation" className="flex items-center gap-2">
            <IconArrowLeft className="size-4" />
            Back
          </Link>
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-muted-foreground">
                <IconChecklist className="size-4" />
                Reconciliation row
              </div>
              <CardTitle className="mt-2 text-2xl">{row.customerName}</CardTitle>
              <CardDescription>
                Compare per books values vs extracted 2307 totals.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={status} />
              <Badge variant="outline">{row.invoiceNumber}</Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          {emailError ? (
            <div className="lg:col-span-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {emailError}
            </div>
          ) : null}
          <div className="space-y-4">
            <Card className="border-border/60 bg-muted/40">
              <CardHeader>
                <CardTitle className="text-base">Reference</CardTitle>
                <CardDescription>Identifiers used for matching.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">TIN:</span> {row.tin}
                </p>
                <p>
                  <span className="text-muted-foreground">Invoice:</span>{' '}
                  {row.invoiceNumber}
                </p>
                <p>
                  <span className="text-muted-foreground">Derived billing month:</span>{' '}
                  {row.derivedBillingMonthMMYY}
                </p>
                <p>
                  <span className="text-muted-foreground">Accounting date:</span>{' '}
                  {row.accountingDate ?? '—'}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-muted/40">
              <CardHeader>
                <CardTitle className="text-base">Variance</CardTitle>
                <CardDescription>Difference between sources.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Tax base difference:</span>{' '}
                  {formatAmount(row.taxBaseDifference)}
                </p>
                <p>
                  <span className="text-muted-foreground">Tax withheld difference:</span>{' '}
                  {formatAmount(row.taxWithheldDifference)}
                </p>
                <p>
                  <span className="text-muted-foreground">Match status:</span>{' '}
                  <StatusPill status={row.matchStatus} className="align-middle" />
                </p>
                <p>
                  <span className="text-muted-foreground">Email sent:</span>{' '}
                  {formatEmailSentStatus(row.emailSentAt)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="border-border/60 bg-muted/40">
              <CardHeader>
                <CardTitle className="text-base">Books</CardTitle>
                <CardDescription>From revenue/prepaid CWT records.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Taxable Sales:</span>{' '}
                  {formatAmount(row.taxableSales)}
                </p>
                <p>
                  <span className="text-muted-foreground">Output VAT:</span>{' '}
                  {formatAmount(row.outputVAT)}
                </p>
                <p>
                  <span className="text-muted-foreground">Prepaid CWT:</span>{' '}
                  {formatAmount(row.prepaidCWT)}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-muted/40">
              <CardHeader>
                <CardTitle className="text-base">2307</CardTitle>
                <CardDescription>From extracted and validated 2307 forms.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Tax Base:</span>{' '}
                  {formatAmount(row.taxBase)}
                </p>
                <p>
                  <span className="text-muted-foreground">Tax Withheld:</span>{' '}
                  {formatAmount(row.taxWithheld)}
                </p>
                <p>
                  <span className="text-muted-foreground">Matched tax record ID:</span>{' '}
                  {row.matchedTaxRecordId ?? '—'}
                </p>
              </CardContent>
            </Card>

            <Separator />

            <Card className="border-border/60 bg-muted/40">
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
                <CardDescription>
                  Follow up on customer variances or unmatched rows.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {row.hasDifference &&
                row.matchStatus === 'unmatched' &&
                !row.emailSentAt ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSendingEmail}
                    onClick={() => void handleSendEmail()}
                  >
                    {isSendingEmail ? 'Sending...' : 'Email customer'}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>
                    No action required
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
