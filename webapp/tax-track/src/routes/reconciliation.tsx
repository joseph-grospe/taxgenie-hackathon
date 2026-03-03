import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import {
  IconCloudUpload,
  IconFileSpreadsheet,
  IconShieldCheck,
} from '@tabler/icons-react'
import { useState } from 'react'

import { AppShell } from '@/components/app-shell'
import { authClient } from '@/lib/auth-client'
import { canExport, parseSessionContext } from '@/lib/access-control'
import { ReconciliationDetailDrawer } from '@/components/reconciliation-detail-drawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { reconciliationRows, reconciliationSummary } from '@/data/mock-data'

export const Route = createFileRoute('/reconciliation')({
  component: RouteComponent,
})

function RouteComponent() {
  const { data: session } = authClient.useSession()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const isDetailRoute =
    pathname !== '/reconciliation' && pathname.startsWith('/reconciliation/')
  const context = session?.user ? parseSessionContext(session.user) : null
  const canExportSheet = context
    ? canExport.excel(context.role, context.canExportExcel)
    : false

  // This route is the parent of `/reconciliation/$rowId`; render the child page
  // via <Outlet /> when we're on a detail URL.
  if (isDetailRoute) return <Outlet />

  const [selectedId, setSelectedId] = useState(() => reconciliationRows[0].id)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const selectedRow =
    reconciliationRows.find((row) => row.id === selectedId) ??
    reconciliationRows[0]

  const status = selectedRow.variance === '0.00' ? 'Matched' : 'Variance'

  return (
    <AppShell
      title="Reconciliation"
      subtitle="Match extracted 2307 data with prepaid CWT records"
      actions={
        <Button size="sm">
          <IconShieldCheck className="size-4" />
          Run reconciliation
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="border border-dashed">
          <CardHeader>
            <CardTitle>Import revenue data</CardTitle>
            <CardDescription>
              Bring in prepaid CWT records for matching.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-44 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-emerald-500/30 bg-emerald-500/5 text-center">
              <div className="rounded-full border border-emerald-500/30 bg-white p-3 text-emerald-700">
                <IconCloudUpload className="size-5" />
              </div>
              <div className="text-sm font-medium">
                Drop reconciliation sheet
              </div>
              <p className="text-xs text-muted-foreground">
                CSV or XLSX, template aligned to Annex C
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reconciliation summary</CardTitle>
            <CardDescription>Q4 2025 monthly rollup</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Total records
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {reconciliationSummary.totalRecords}
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Matched
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {reconciliationSummary.matched}
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Unmatched
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {reconciliationSummary.unmatched}
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Variance total
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {reconciliationSummary.varianceTotal}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Reconciliation table</CardTitle>
              <CardDescription>
                Compare per books vs collected 2307.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" disabled={!canExportSheet}>
              <IconFileSpreadsheet className="size-4" />
              Export sheet
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>TIN</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead>GL Date</TableHead>
                <TableHead className="text-right">Books Base</TableHead>
                <TableHead className="text-right">Books CWT</TableHead>
                <TableHead className="text-right">2307 Base</TableHead>
                <TableHead className="text-right">2307 CWT</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconciliationRows.map((row) => (
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  onClick={() => {
                    setSelectedId(row.id)
                    setDrawerOpen(true)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedId(row.id)
                      setDrawerOpen(true)
                    }
                  }}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  title="View reconciliation detail"
                >
                  <TableCell className="font-medium">{row.customer}</TableCell>
                  <TableCell>{row.tin}</TableCell>
                  <TableCell>{row.invoice}</TableCell>
                  <TableCell>{row.billing}</TableCell>
                  <TableCell>{row.glDate}</TableCell>
                  <TableCell className="text-right">{row.booksBase}</TableCell>
                  <TableCell className="text-right">{row.booksCwt}</TableCell>
                  <TableCell className="text-right">{row.formBase}</TableCell>
                  <TableCell className="text-right">{row.formCwt}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline">{row.variance}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ReconciliationDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={selectedRow.customer}
        subtitle={selectedRow.invoice}
        status={status}
        meta={[
          { label: 'TIN', value: selectedRow.tin },
          { label: 'Billing period', value: selectedRow.billing },
          { label: 'GL date', value: selectedRow.glDate },
        ]}
        amounts={[
          { label: 'Books base', value: selectedRow.booksBase },
          { label: 'Books CWT', value: selectedRow.booksCwt },
          { label: '2307 base', value: selectedRow.formBase },
          { label: '2307 CWT', value: selectedRow.formCwt },
          { label: 'Variance', value: selectedRow.variance },
        ]}
        openTo={`/reconciliation/${selectedRow.id}`}
      />
    </AppShell>
  )
}
