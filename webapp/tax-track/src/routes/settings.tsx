import { createFileRoute } from '@tanstack/react-router'
import { IconSettings } from '@tabler/icons-react'

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { adminUsers, atcRates } from '@/data/mock-data'

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <AppShell
      title="Admin Settings"
      subtitle="Roles, ATC codes, and retention policy"
      actions={
        <Button size="sm" variant="outline">
          <IconSettings className="size-4" />
          Save changes
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Users & roles</CardTitle>
            <CardDescription>
              Manage access and reviewer permissions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adminUsers.map((user) => (
                  <TableRow key={user.email}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{user.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{user.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>ATC codes</CardTitle>
              <CardDescription>
                Maintain work-back rates used in validation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {atcRates.map((rate) => (
                <div
                  key={rate.code}
                  className="flex items-center justify-between rounded-2xl border border-border/60 bg-muted/40 p-4"
                >
                  <div>
                    <p className="text-sm font-semibold">{rate.code}</p>
                    <p className="text-xs text-muted-foreground">
                      {rate.description}
                    </p>
                  </div>
                  <Badge variant="outline">{rate.rate}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Retention policy</CardTitle>
              <CardDescription>
                Define how long raw files remain in storage.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Raw PDFs retained: 12 months</p>
              <p>Derived images retained: 90 days</p>
              <p>Extracted JSON retained: 24 months</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
