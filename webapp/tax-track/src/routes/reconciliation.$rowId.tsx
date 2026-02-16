import { Link, createFileRoute } from '@tanstack/react-router'
import { IconArrowLeft, IconChecklist } from '@tabler/icons-react'

import { AppShell } from '@/components/app-shell'
import { StatusPill } from '@/components/status-pill'
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
import { reconciliationRows } from '@/data/mock-data'

export const Route = createFileRoute('/reconciliation/$rowId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { rowId } = Route.useParams()
  const row = reconciliationRows.find((r) => r.id === rowId)

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
              This reconciliation row may have been removed or the link is invalid.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppShell>
    )
  }

  const status = row.variance === '0.00' ? 'Matched' : 'Variance'

  return (
    <AppShell
      title="Reconciliation Detail"
      subtitle={row.id}
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
              <CardTitle className="mt-2 text-2xl">{row.customer}</CardTitle>
              <CardDescription>
                Compare per books values vs extracted 2307 totals.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={status} />
              <Badge variant="outline">{row.invoice}</Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
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
                  <span className="text-muted-foreground">Invoice:</span> {row.invoice}
                </p>
                <p>
                  <span className="text-muted-foreground">Billing period:</span>{' '}
                  {row.billing}
                </p>
                <p>
                  <span className="text-muted-foreground">GL date:</span> {row.glDate}
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
                  <span className="text-muted-foreground">Variance:</span> {row.variance}
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
                  <span className="text-muted-foreground">Base:</span> {row.booksBase}
                </p>
                <p>
                  <span className="text-muted-foreground">CWT:</span> {row.booksCwt}
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
                  <span className="text-muted-foreground">Base:</span> {row.formBase}
                </p>
                <p>
                  <span className="text-muted-foreground">CWT:</span> {row.formCwt}
                </p>
              </CardContent>
            </Card>

            <Separator />

            <Card className="border-border/60 bg-muted/40">
              <CardHeader>
                <CardTitle className="text-base">Actions (Placeholder)</CardTitle>
                <CardDescription>
                  Approve match, create adjustment, or open source documents.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled>
                  Approve
                </Button>
                <Button size="sm" variant="outline" disabled>
                  Create adjustment
                </Button>
                <Button size="sm" variant="outline" disabled>
                  View source docs
                </Button>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
