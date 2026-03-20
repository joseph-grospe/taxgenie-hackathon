import { IconRefresh } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'

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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type BatchFileView = {
  id: string
  batchId: string
  fileName: string
  sizeBytes: number
  queueStatus: string
  processingStatus: string
  overallStatus: string
  currentPhase: string | null
  currentStep: string | null
  errorMessage: string | null
  worker: {
    jobId: string
    status: string
    currentPhase: string | null
    currentStep: string | null
    startedAt: string | null
    finishedAt: string | null
    errorSummary: string | null
  } | null
  result: {
    outcome: string
    reasonCodes: Array<string>
  } | null
}

type BatchView = {
  id: string
  status: string
  totalFiles: number
  createdAt: string
  updatedAt: string
  counts: Record<string, number>
  files: Array<BatchFileView>
}

const POLL_INTERVAL_MS = 8_000

const formatDate = (value: string | null | undefined) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const toStatusLabel = (status: string) => {
  switch (status) {
    case 'success':
      return 'Done'
    case 'duplicate':
      return 'Duplicate'
    case 'error':
    case 'completed_with_errors':
      return 'Error'
    case 'processing':
      return 'Processing'
    case 'queued':
      return 'Queued'
    case 'completed':
      return 'Done'
    default:
      return 'Pending'
  }
}

export const Route = createFileRoute('/batch-status')({
  component: RouteComponent,
})

function RouteComponent() {
  const [batches, setBatches] = useState<Array<BatchView>>([])
  const [selectedBatchId, setSelectedBatchId] = useState<string>('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refreshBatches = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/batches', {
        cache: 'no-store',
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(payload?.error || `Failed to load batches (${response.status}).`)
      }

      const payload = (await response.json()) as { batches?: Array<BatchView> }
      const nextBatches = Array.isArray(payload.batches) ? payload.batches : []
      setBatches(nextBatches)
      setSelectedBatchId((current) =>
        current && nextBatches.some((batch) => batch.id === current)
          ? current
          : nextBatches[0]?.id ?? '',
      )
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load batches.')
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    refreshBatches()
    const interval = window.setInterval(refreshBatches, POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [refreshBatches])

  const selectedBatch = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) ?? batches[0] ?? null,
    [batches, selectedBatchId],
  )

  const portfolioCounts = useMemo(() => {
    return batches.reduce(
      (acc, batch) => {
        acc.queued += batch.counts.queued ?? 0
        acc.processing += batch.counts.processing ?? 0
        acc.success += batch.counts.success ?? 0
        acc.duplicate += batch.counts.duplicate ?? 0
        acc.error += batch.counts.error ?? 0
        return acc
      },
      {
        queued: 0,
        processing: 0,
        success: 0,
        duplicate: 0,
        error: 0,
      },
    )
  }, [batches])

  return (
    <AppShell
      title="Batch Status"
      subtitle="Monitor live worker progress across uploaded batches."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refreshBatches()}
          disabled={isRefreshing}
        >
          <IconRefresh className="size-4" />
          Refresh
        </Button>
      }
    >
      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {loadError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard label="Queued" value={portfolioCounts.queued} />
        <MetricCard label="Processing" value={portfolioCounts.processing} />
        <MetricCard label="Done" value={portfolioCounts.success} />
        <MetricCard label="Duplicate" value={portfolioCounts.duplicate} />
        <MetricCard label="Error" value={portfolioCounts.error} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent batches</CardTitle>
            <CardDescription>
              Select a batch to inspect its queued and worker state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {batches.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                No intake batches available.
              </div>
            ) : (
              batches.map((batch) => (
                <button
                  key={batch.id}
                  type="button"
                  onClick={() => setSelectedBatchId(batch.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedBatch?.id === batch.id
                      ? 'border-foreground/20 bg-muted/40'
                      : 'border-border/60 bg-background'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{batch.id}</span>
                    <StatusPill status={toStatusLabel(batch.status)} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDate(batch.createdAt)} • {batch.totalFiles} files
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">Queued {batch.counts.queued ?? 0}</Badge>
                    <Badge variant="outline">
                      Processing {batch.counts.processing ?? 0}
                    </Badge>
                    <Badge variant="outline">Done {batch.counts.success ?? 0}</Badge>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Batch detail</CardTitle>
            <CardDescription>
              Queue submission, worker phase, and terminal outcomes for each file.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedBatch ? (
              <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                Select a batch to inspect file-level activity.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={toStatusLabel(selectedBatch.status)} />
                  <Badge variant="outline">
                    Created {formatDate(selectedBatch.createdAt)}
                  </Badge>
                  <Badge variant="outline">
                    Updated {formatDate(selectedBatch.updatedAt)}
                  </Badge>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Phase</TableHead>
                      <TableHead>Step</TableHead>
                      <TableHead>Worker</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedBatch.files.map((file) => (
                      <TableRow key={file.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{file.fileName}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatBytes(file.sizeBytes)}
                            </span>
                            {file.errorMessage ? (
                              <span className="text-xs text-rose-600">
                                {file.errorMessage}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusPill status={toStatusLabel(file.overallStatus)} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {file.currentPhase ?? 'upload'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {file.currentStep ?? file.queueStatus}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {file.worker?.jobId ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {file.result?.outcome ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}

function MetricCard({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-2 text-3xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}
