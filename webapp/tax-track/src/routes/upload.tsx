import { createFileRoute } from '@tanstack/react-router'
import {
  IconClockHour4,
  IconRefresh,
  IconShieldCheck,
} from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { driveIntakeEvents, driveIntakeStatus } from '@/data/mock-data'

type IngestionFileEvent = {
  id: string
  at: string
  type: string
  detail: string
  enqueued: number | string
  status: string
}

type IntakeStatus = {
  source: string
  folder: {
    name: string
    id: string
  }
  ingestion: {
    status: string
    webhookHealth: string
    lastSyncAt: string
    channelExpiresAt: string
  }
  backfill: {
    status: string
    startedAt: string
    finishedAt: string
    imported: number
    processed: number
    queued: number
    errors: number
    duplicates: number
  }
}

type S3IntakeDebug = {
  bucket: string
  region: string
  prefix: string
  maxKeys: number
  objectCount: number
  sampleKeys: Array<string>
  queriedAt: string
}

const POLL_INTERVAL_MS = 10_000

export const Route = createFileRoute('/upload')({
  component: RouteComponent,
})

function RouteComponent() {
  const [driveIntakeStatusState, setDriveIntakeStatusState] =
    useState<IntakeStatus>(driveIntakeStatus)
  const [driveIntakeEventsState, setDriveIntakeEventsState] = useState<
    Array<IngestionFileEvent>
  >(driveIntakeEvents)
  const [s3DebugState, setS3DebugState] = useState<S3IntakeDebug | null>(null)
  const [lastAction, setLastAction] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef(false)
  const isMountedRef = useRef(true)
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchIntakeStatus = useCallback(async () => {
    if (inFlightRef.current) {
      return
    }

    inFlightRef.current = true
    setIsLoading(true)
    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      const response = await fetch('/api/s3-events', {
        cache: 'no-store',
        signal: abortController.signal,
      })

      if (!response.ok) {
        let message = `Failed to fetch intake metadata (${response.status})`
        try {
          const body = (await response.json()) as { error?: unknown }
          if (typeof body.error === 'string' && body.error.length > 0) {
            message = `${message}: ${body.error}`
          }
        } catch {
          // ignore malformed response body
        }

        throw new Error(message)
      }

      const payload = (await response.json()) as {
        status?: IntakeStatus
        events?: Array<IngestionFileEvent>
        debug?: S3IntakeDebug
      }

      if (!payload.status || !Array.isArray(payload.events)) {
        throw new Error('Malformed intake payload')
      }

      if (!isMountedRef.current) {
        return
      }

      setDriveIntakeStatusState(payload.status)
      setDriveIntakeEventsState(payload.events)
      setS3DebugState(payload.debug ?? null)
      setPollError(null)
    } catch (error) {
      if (!isMountedRef.current) {
        return
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      setPollError(
        error instanceof Error
          ? error.message
          : 'Unable to load live S3 metadata',
      )
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
      inFlightRef.current = false
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    if (intervalRef.current) {
      return
    }

    fetchIntakeStatus()
    intervalRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchIntakeStatus()
      }
    }, POLL_INTERVAL_MS)
  }, [fetchIntakeStatus])

  useEffect(() => {
    isMountedRef.current = true

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        startPolling()
      } else {
        stopPolling()
      }
    }

    window.addEventListener('focus', startPolling)
    window.addEventListener('blur', stopPolling)
    document.addEventListener('visibilitychange', handleVisibility)
    handleVisibility()

    return () => {
      isMountedRef.current = false
      stopPolling()
      window.removeEventListener('focus', startPolling)
      window.removeEventListener('blur', stopPolling)
      document.removeEventListener('visibilitychange', handleVisibility)
      abortControllerRef.current?.abort()
    }
  }, [startPolling, stopPolling])

  const lastEventAt = driveIntakeEventsState[0]?.at ?? 'N/A'

  const statusText = pollError
    ? `Polling disabled for demo endpoint: ${pollError}`
    : s3DebugState
    ? `Polling active. Bucket ${s3DebugState.bucket} (prefix: ${s3DebugState.prefix}).`
    : 'Polling active and synced to API.'

  return (
    <AppShell
      title="S3 Intake"
      subtitle="Ingestion status, backfill, and sync controls"
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLastAction('Catch-up sync queued')}
          >
            <IconRefresh className="size-4" />
            Run catch-up
          </Button>
          <Button size="sm" onClick={() => setLastAction('Backfill queued')}>
            <IconShieldCheck className="size-4" />
            Trigger backfill
          </Button>
        </div>
      }
    >
      {lastAction || pollError || s3DebugState?.objectCount === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">System:</span>{' '}
          {lastAction ?? statusText}
          {isLoading ? ' Refreshing…' : null}
          {!pollError && s3DebugState && s3DebugState.objectCount === 0 ? (
            <div className="mt-2 text-xs">
              No objects returned. Last query returned 0 keys. Check upload target
              and permissions.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Source configuration</CardTitle>
            <CardDescription>
              Production flow does not upload PDFs in TaxTrack. Files are
              ingested from a preconfigured S3 bucket.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Source
              </p>
              <p className="text-sm font-medium">
                {driveIntakeStatusState.source}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Ingestion
              </p>
              <div className="flex items-center gap-2">
                <StatusPill status={driveIntakeStatusState.ingestion.status} />
                <span className="text-sm text-muted-foreground">
                  Webhook: {driveIntakeStatusState.ingestion.webhookHealth}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Folder
              </p>
              <p className="text-sm font-medium">
                {driveIntakeStatusState.folder.name}
              </p>
              <p className="text-xs text-muted-foreground">
                ID: {driveIntakeStatusState.folder.id}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Last change event
              </p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconClockHour4 className="size-4" />
                <span>{lastEventAt}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Channel expires: {driveIntakeStatusState.ingestion.channelExpiresAt}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Backfill</CardTitle>
            <CardDescription>
              Used to ingest existing files already present in the watched S3
              prefix.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-muted/40 p-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Status
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <StatusPill status={driveIntakeStatusState.backfill.status} />
                    <span className="text-sm text-muted-foreground">
                      {driveIntakeStatusState.backfill.startedAt} →{' '}
                      {driveIntakeStatusState.backfill.finishedAt}
                    </span>
                  </div>
                </div>
                <Badge variant="outline">
                  {driveIntakeStatusState.backfill.imported} files
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Processed
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {driveIntakeStatusState.backfill.processed}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Queued
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {driveIntakeStatusState.backfill.queued}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Errors
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {driveIntakeStatusState.backfill.errors}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Duplicates
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {driveIntakeStatusState.backfill.duplicates}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Recent intake activity</CardTitle>
              <CardDescription>
                Events are derived from S3 object listings and backfill runs.
              </CardDescription>
            </div>
            <Badge variant="outline">
              Last sync: {driveIntakeStatusState.ingestion.lastSyncAt}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead className="text-right">Enqueued</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {driveIntakeEventsState.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{event.id}</span>
                      <span className="text-xs text-muted-foreground">
                        {event.at}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{event.type}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.detail}
                  </TableCell>
                  <TableCell className="text-right">{event.enqueued}</TableCell>
                  <TableCell className="text-right">
                    <StatusPill status={event.status} />
                  </TableCell>
                </TableRow>
              ))}
              {driveIntakeEventsState.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No bucket objects found yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  )
}
