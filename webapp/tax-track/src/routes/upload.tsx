import { createFileRoute } from '@tanstack/react-router'
import {
  IconClockHour4,
  IconRefresh,
  IconShieldCheck,
} from '@tabler/icons-react'
import { useMemo, useState } from 'react'

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

export const Route = createFileRoute('/upload')({
  component: RouteComponent,
})

function RouteComponent() {
  const [lastAction, setLastAction] = useState<string | null>(null)
  const lastEventAt = useMemo(() => driveIntakeEvents[0]?.at ?? 'N/A', [])

  return (
    <AppShell
      title="Drive Intake"
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
      {lastAction ? (
        <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">System:</span>{' '}
          {lastAction}. This is currently a UI stub (no API call wired yet).
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Source configuration</CardTitle>
            <CardDescription>
              Production flow does not upload PDFs in TaxTrack. Files are
              ingested from a preconfigured Drive folder.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Source
              </p>
              <p className="text-sm font-medium">{driveIntakeStatus.source}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Ingestion
              </p>
              <div className="flex items-center gap-2">
                <StatusPill status={driveIntakeStatus.ingestion.status} />
                <span className="text-sm text-muted-foreground">
                  Webhook: {driveIntakeStatus.ingestion.webhookHealth}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Folder
              </p>
              <p className="text-sm font-medium">
                {driveIntakeStatus.folder.name}
              </p>
              <p className="text-xs text-muted-foreground">
                ID: {driveIntakeStatus.folder.id}
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
                Channel expires: {driveIntakeStatus.ingestion.channelExpiresAt}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Backfill</CardTitle>
            <CardDescription>
              Used to ingest existing files already present in the watched Drive
              folder.
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
                    <StatusPill status={driveIntakeStatus.backfill.status} />
                    <span className="text-sm text-muted-foreground">
                      {driveIntakeStatus.backfill.startedAt} →{' '}
                      {driveIntakeStatus.backfill.finishedAt}
                    </span>
                  </div>
                </div>
                <Badge variant="outline">
                  {driveIntakeStatus.backfill.imported} files
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Processed
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {driveIntakeStatus.backfill.processed}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Queued
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {driveIntakeStatus.backfill.queued}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Errors
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {driveIntakeStatus.backfill.errors}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-muted/40 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Duplicates
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {driveIntakeStatus.backfill.duplicates}
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
                Events are derived from Drive changes and backfill runs.
              </CardDescription>
            </div>
            <Badge variant="outline">
              Last sync: {driveIntakeStatus.ingestion.lastSyncAt}
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
              {driveIntakeEvents.map((event) => (
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
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  )
}
