import { createFileRoute } from '@tanstack/react-router'
import { IconClockHour4, IconPlaylistAdd, IconRadar } from '@tabler/icons-react'
import { useState } from 'react'

import { AppShell } from '@/components/app-shell'
import { DocumentDetailDrawer } from '@/components/document-detail-drawer'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  batchDocumentDetails,
  batchDocuments,
  batchStages,
  documentDetailsByFileName,
} from '@/data/mock-data'

export const Route = createFileRoute('/batch-status')({
  component: RouteComponent,
})

function getTrailAndNextStep(status?: string, stage?: string) {
  const trail = [
    { label: 'Ingested (Drive)', status: 'complete' as const },
    { label: 'Queued', status: 'pending' as const },
    { label: 'OCR / Layout', status: 'pending' as const },
    { label: 'AI Normalize', status: 'pending' as const },
    { label: 'Validation + Variance', status: 'pending' as const },
    { label: 'Deduplication', status: 'pending' as const },
    { label: 'Rename + Persist', status: 'pending' as const },
    { label: 'Reconciliation', status: 'pending' as const },
  ]

  const markUpTo = (label: string) => {
    let found = false
    return trail.map((step) => {
      if (found) return step
      if (step.label === label) {
        found = true
        return { ...step, status: 'active' as const, detail: stage }
      }
      return { ...step, status: 'complete' as const }
    })
  }

  if (status === 'Error') {
    const t = markUpTo('Validation + Variance').map((step) =>
      step.label === 'Validation + Variance'
        ? {
            ...step,
            status: 'error' as const,
            detail: stage ?? 'Validation failed',
          }
        : step,
    )
    return { trail: t, nextStep: 'Review in Issues Queue' }
  }

  if (status === 'OCR')
    return { trail: markUpTo('OCR / Layout'), nextStep: 'AI Normalize' }
  if (status === 'Validation')
    return {
      trail: markUpTo('Validation + Variance'),
      nextStep: 'Deduplication',
    }

  if (status === 'Done') {
    const t = trail.map((step) =>
      step.label === 'Reconciliation'
        ? step
        : { ...step, status: 'complete' as const },
    )
    return { trail: t, nextStep: 'Reconciliation / reporting' }
  }

  return { trail, nextStep: 'Awaiting status update' }
}

function RouteComponent() {
  const [selectedId, setSelectedId] = useState(
    () => batchDocuments[0]?.id ?? '',
  )
  const [drawerOpen, setDrawerOpen] = useState(false)
  const selectedDoc =
    batchDocuments.find((doc) => doc.id === selectedId) ?? batchDocuments[0]
  const selectedDetails = selectedDoc
    ? (batchDocumentDetails[selectedDoc.id] ??
      documentDetailsByFileName[selectedDoc.fileName])
    : undefined
  const { trail, nextStep } = getTrailAndNextStep(
    selectedDoc?.status,
    selectedDoc?.stage,
  )

  return (
    <AppShell
      title="Batch Status"
      subtitle="Monitor live extraction and validation"
      actions={
        <Button size="sm" variant="outline">
          <IconPlaylistAdd className="size-4" />
          Re-run failed
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Batch B-2026-011</CardTitle>
              <CardDescription>
                Queued → OCR → AI → Validation → Done
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <IconClockHour4 className="size-3" />
                ETA 4m
              </Badge>
              <Badge variant="outline" className="gap-1">
                <IconRadar className="size-3" />
                Live sync
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-5">
            {batchStages.map((stage) => (
              <div
                key={stage.label}
                className="rounded-2xl border border-border/60 bg-muted/40 p-4"
              >
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  {stage.label}
                </p>
                <p className="mt-2 text-2xl font-semibold">{stage.value}</p>
                <Badge
                  variant="outline"
                  className="mt-2 border-emerald-500/20 text-xs"
                >
                  {stage.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents in progress</CardTitle>
          <CardDescription>
            Track status by document with confidence scores.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>ATC</TableHead>
                <TableHead>Payee</TableHead>
                <TableHead className="text-right">Tax Base</TableHead>
                <TableHead className="text-right">Tax Withheld</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batchDocuments.map((doc) => (
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
                  title="View document details"
                >
                  <TableCell className="font-medium">{doc.fileName}</TableCell>
                  <TableCell>
                    <StatusPill status={doc.status} />
                  </TableCell>
                  <TableCell>{doc.stage}</TableCell>
                  <TableCell>{doc.confidence}</TableCell>
                  <TableCell>{doc.atc}</TableCell>
                  <TableCell>{doc.payee}</TableCell>
                  <TableCell className="text-right">{doc.taxBase}</TableCell>
                  <TableCell className="text-right">
                    {doc.taxWithheld}
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
        title={selectedDoc?.fileName ?? 'Document detail'}
        subtitle={selectedDoc?.id}
        status={selectedDoc?.status}
        stage={selectedDoc?.stage}
        nextStep={nextStep}
        trail={trail}
        confidence={selectedDoc?.confidence}
        atc={selectedDoc?.atc}
        payee={selectedDoc?.payee}
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
        openTo={selectedDoc?.id ? `/documents/${selectedDoc.id}` : undefined}
      />
    </AppShell>
  )
}
