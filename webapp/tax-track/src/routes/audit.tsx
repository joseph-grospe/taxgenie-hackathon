import { createFileRoute } from '@tanstack/react-router'
import { IconFilter, IconSearch, IconShieldCheck } from '@tabler/icons-react'

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
import { auditLogs } from '@/data/mock-data'

export const Route = createFileRoute('/audit')({
  component: RouteComponent,
})

function RouteComponent() {
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
              {auditLogs.map((log) => (
                <TableRow key={`${log.time}-${log.object}`}>
                  <TableCell className="text-muted-foreground">
                    {log.time}
                  </TableCell>
                  <TableCell>{log.actor}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{log.action}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{log.object}</TableCell>
                  <TableCell>{log.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  )
}
