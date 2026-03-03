import { createFileRoute } from '@tanstack/react-router'
import { IconDownload, IconFilter, IconSearch } from '@tabler/icons-react'
import { useState } from 'react'

import { AppShell } from '@/components/app-shell'
import { authClient } from '@/lib/auth-client'
import { canExport, parseSessionContext } from '@/lib/access-control'
import { DocumentDetailDrawer } from '@/components/document-detail-drawer'
import { StatusPill } from '@/components/status-pill'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { documentDetailsByFileName, validatedDocuments } from '@/data/mock-data'

export const Route = createFileRoute('/validated')({
  component: RouteComponent,
})

function getValidatedTrailAndNextStep(status?: string) {
  const trail = [
    { label: 'Ingested (Drive)', status: 'complete' as const },
    { label: 'Queued', status: 'complete' as const },
    { label: 'OCR / Layout', status: 'complete' as const },
    { label: 'AI Normalize', status: 'complete' as const },
    { label: 'Validation + Variance', status: 'complete' as const },
    { label: 'Deduplication', status: 'complete' as const },
    { label: 'Rename + Persist', status: 'complete' as const },
    { label: 'Reconciliation', status: 'pending' as const },
  ]

  void status
  return { trail, nextStep: 'Export / reconciliation' }
}

function RouteComponent() {
  const { data: session } = authClient.useSession()
  const [selectedId, setSelectedId] = useState(() => validatedDocuments[0].id)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const context = session?.user ? parseSessionContext(session.user) : null
  const canExportSelected = context
    ? canExport.pdf(context.role, context.canExportPdf) ||
      canExport.excel(context.role, context.canExportExcel)
    : false

  const selectedDoc =
    validatedDocuments.find((doc) => doc.id === selectedId) ??
    validatedDocuments[0]
  const selectedDetails = documentDetailsByFileName[selectedDoc.fileName]
  const { trail, nextStep } = getValidatedTrailAndNextStep(selectedDoc.status)

  return (
    <AppShell
      title="Validated Results"
      subtitle="Ready-to-export 2307 extractions"
      actions={
        <Button size="sm" disabled={!canExportSelected}>
          <IconDownload className="size-4" />
          Export selected
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Validated documents</CardTitle>
              <CardDescription>
                Bulk download or filter by period.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search payee or TIN" />
              </div>
              <Button variant="outline" size="sm">
                <IconFilter className="size-4" />
                Filters
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document ID</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Payee</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>ATC</TableHead>
                <TableHead className="text-right">Tax Base</TableHead>
                <TableHead className="text-right">Tax Withheld</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {validatedDocuments.map((doc) => (
                <TableRow
                  key={doc.id}
                  tabIndex={0}
                  onClick={() => {
                    setSelectedId(doc.id)
                    setDrawerOpen(true)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedId(doc.id)
                      setDrawerOpen(true)
                    }
                  }}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  title="View validated document details"
                >
                  <TableCell className="font-medium">{doc.id}</TableCell>
                  <TableCell>{doc.fileName}</TableCell>
                  <TableCell>{doc.payee}</TableCell>
                  <TableCell>{doc.period}</TableCell>
                  <TableCell>{doc.atc}</TableCell>
                  <TableCell className="text-right">{doc.taxBase}</TableCell>
                  <TableCell className="text-right">
                    {doc.taxWithheld}
                  </TableCell>
                  <TableCell>{doc.confidence}</TableCell>
                  <TableCell>
                    <StatusPill status={doc.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DocumentDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={selectedDoc.fileName}
        subtitle={selectedDoc.id}
        status={selectedDoc.status}
        stage="Validated"
        nextStep={nextStep}
        trail={trail}
        confidence={selectedDoc.confidence}
        atc={selectedDoc.atc}
        payee={selectedDoc.payee}
        meta={[
          { label: 'Period', value: selectedDoc.period },
          { label: 'Tax Base', value: selectedDoc.taxBase },
          { label: 'Tax Withheld', value: selectedDoc.taxWithheld },
        ]}
        processing={
          selectedDetails
            ? {
                startedAt: selectedDetails.startedAt,
                updatedAt: selectedDetails.updatedAt,
                worker: selectedDetails.worker,
                elapsed: selectedDetails.elapsed,
              }
            : undefined
        }
        logs={selectedDetails?.logs}
        errors={selectedDetails?.errors}
        openTo={`/documents/${selectedDoc.id}`}
      />
    </AppShell>
  )
}
