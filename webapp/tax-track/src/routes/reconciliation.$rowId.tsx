import { Link, createFileRoute } from '@tanstack/react-router'
import { IconArrowLeft } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { ReconciliationRowView } from '@/lib/reconciliation-types'
import { AppShell } from '@/components/app-shell'
import { ReconciliationRowPage } from '@/components/reconciliation-row-page'
import { defaultReconciliationSearch } from '@/lib/reconciliation-search-state'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/reconciliation/$rowId')({
  component: RouteComponent,
})

function BackToReconciliationButton() {
  return (
    <Button
      size="sm"
      variant="outline"
      render={
        <Link to="/reconciliation" search={defaultReconciliationSearch} />
      }
    >
      <IconArrowLeft data-icon="inline-start" />
      Back
    </Button>
  )
}

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
      const payload = (await response.json().catch(() => null)) as {
        row?: ReconciliationRowView
        error?: string
      } | null

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
      const payload = (await response.json().catch(() => null)) as {
        message?: string
        error?: string
        to?: Array<string>
        cc?: Array<string>
        customerName?: string
        sentRowCount?: number
        sentRowIds?: Array<number>
      } | null

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
        title="Reconciliation Row"
        subtitle={rowId}
        leadingActions={<BackToReconciliationButton />}
      >
        <section className="rounded-lg border border-border/60 bg-background p-4">
          <h2 className="text-base font-semibold">Loading row</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fetching reconciliation detail...
          </p>
        </section>
      </AppShell>
    )
  }

  if (!row) {
    return (
      <AppShell
        title="Reconciliation Row"
        subtitle={rowId}
        leadingActions={<BackToReconciliationButton />}
      >
        <section className="rounded-lg border border-border/60 bg-background p-4">
          <h2 className="text-base font-semibold">Row not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loadError ??
              'This reconciliation row may have been removed or the link is invalid.'}
          </p>
        </section>
      </AppShell>
    )
  }

  return (
    <AppShell
      title="Reconciliation Row"
      subtitle={`${row.customerName} · ${row.invoiceNumber}`}
      leadingActions={<BackToReconciliationButton />}
    >
      <ReconciliationRowPage
        row={row}
        emailError={emailError}
        isSendingEmail={isSendingEmail}
        onSendEmail={() => {
          void handleSendEmail()
        }}
      />
    </AppShell>
  )
}
