import { createFileRoute } from '@tanstack/react-router'
import { IconDownload, IconReportAnalytics } from '@tabler/icons-react'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { reportRuns } from '@/data/mock-data'

export const Route = createFileRoute('/reports')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <AppShell
      title="Reports & Export"
      subtitle="Generate monthly and quarterly outputs"
      actions={
        <Button size="sm">
          <IconReportAnalytics className="size-4" />
          Generate report
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Report builder</CardTitle>
            <CardDescription>
              Select period, format, and output template.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Report period</Label>
              <Input placeholder="Dec 2025" />
            </div>
            <div className="space-y-2">
              <Label>Cycle</Label>
              <Select defaultValue="monthly">
                <SelectTrigger>
                  <SelectValue placeholder="Select cycle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Template</Label>
              <Select defaultValue="reconciliation">
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reconciliation">
                    Reconciliation (Annex C)
                  </SelectItem>
                  <SelectItem value="summary">Summary Export</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Format</Label>
              <Select defaultValue="xlsx">
                <SelectTrigger>
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xlsx">XLSX</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Report readiness
            </div>
            <CardTitle className="text-2xl">SLA-friendly outputs</CardTitle>
            <CardDescription>
              Reports are versioned and reproducible for audit submissions.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Last export', value: 'Jan 24, 2026' },
              { label: 'Templates', value: '3 active' },
              { label: 'Avg build', value: '42s' },
              { label: 'Queued', value: '1 job' },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-border/60 bg-muted/30 p-4"
              >
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-2 text-lg font-semibold">{item.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Report history</CardTitle>
          <CardDescription>Download and audit prior outputs.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report ID</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Generated</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportRuns.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="font-medium">{report.id}</TableCell>
                  <TableCell>{report.period}</TableCell>
                  <TableCell>{report.kind}</TableCell>
                  <TableCell>
                    <StatusPill
                      status={
                        report.status === 'Processing' ? 'Processing' : 'Ready'
                      }
                    />
                  </TableCell>
                  <TableCell>{report.generatedAt}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{report.format}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost">
                      <IconDownload className="size-4" />
                    </Button>
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
