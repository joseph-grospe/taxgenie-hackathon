import { createFileRoute } from '@tanstack/react-router'
import { IconFilter, IconSearch, IconShieldCheck } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

import { AppShell } from '@/components/app-shell'
import { Badge } from '@/components/ui/badge'
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

export const Route = createFileRoute('/audit')({
  component: RouteComponent,
})

type AuditLogEntry = {
  id: string
  occurredAt: string
  eventType: string
  actorUserId: string | null
  targetUserId: string | null
  metadata?: Record<string, unknown> | null
}

function RouteComponent() {
  const [auditEvents, setAuditEvents] = useState<Array<AuditLogEntry>>([])
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const loadAuditEvents = async () => {
      try {
        const response = await fetch('/api/audit/events')
        const payload = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(
            typeof payload?.error === 'string'
              ? payload.error
              : 'Unable to load audit events.',
          )
        }

        if (!Array.isArray(payload?.events)) {
          throw new Error('Unexpected audit payload.')
        }

        setAuditEvents(payload.events as Array<AuditLogEntry>)
        setErrorMessage('')
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Unable to load audit events.',
        )
      }
    }

    void loadAuditEvents()
  }, [])

  return (
    <AppShell
      title="Audit Trail"
      subtitle="Immutable system and user activity log"
      actions={
        <Button size="sm" variant="outline">
          <IconShieldCheck className="size-4" />
          Export logs
        </Button>
      }
    >
      <Card>
        <CardHeader>
          {errorMessage ? (
            <p className="mb-2 text-sm text-destructive">{errorMessage}</p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Audit events</CardTitle>
              <CardDescription>
                Track changes, exports, and exception handling.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search audit logs" />
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
                <TableHead>Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Object</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditEvents.length ? (
                auditEvents.map((log) => (
                  <TableRow
                    key={`${log.id}-${log.occurredAt}-${log.actorUserId ?? 'system'}`}
                  >
                    <TableCell className="text-muted-foreground">
                      {new Date(log.occurredAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{log.actorUserId ?? 'System'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.eventType}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{log.targetUserId}</TableCell>
                    <TableCell>
                      {log.metadata ? JSON.stringify(log.metadata) : ''}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    {errorMessage ? 'No audit events available.' : 'Loading events...'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  )
}
