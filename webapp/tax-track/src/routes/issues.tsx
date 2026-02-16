import { createFileRoute } from '@tanstack/react-router'
import {
  IconAlertTriangle,
  IconCopy,
  IconFileAlert,
  IconFilter,
} from '@tabler/icons-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { documentDetailsByFileName, issueQueue } from '@/data/mock-data'

export const Route = createFileRoute('/issues')({
  component: RouteComponent,
})

const errors = issueQueue.filter((issue) => issue.type === 'Error')
const duplicates = issueQueue.filter((issue) => issue.type === 'Duplicate')

function RouteComponent() {
  const [selectedIssue, setSelectedIssue] = useState(() => issueQueue[0])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const selectedDetails = selectedIssue
    ? documentDetailsByFileName[selectedIssue.fileName]
    : undefined

  return (
    <AppShell
      title="Issues Queue"
      subtitle="Duplicates and validation failures"
      actions={
        <Button size="sm" variant="outline">
          <IconFilter className="size-4" />
          Filters
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Duplicates & errors</CardTitle>
              <CardDescription>
                Review and triage documents that need attention.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <IconFileAlert className="size-3" />
                {errors.length} errors
              </Badge>
              <Badge variant="outline" className="gap-1">
                <IconCopy className="size-3" />
                {duplicates.length} duplicates
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="errors">Errors</TabsTrigger>
              <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
            </TabsList>
            <TabsContent value="all" className="mt-4">
              <IssueTable
                rows={issueQueue}
                onSelect={(issue) => {
                  setSelectedIssue(issue)
                  setDrawerOpen(true)
                }}
              />
            </TabsContent>
            <TabsContent value="errors" className="mt-4">
              <IssueTable
                rows={errors}
                onSelect={(issue) => {
                  setSelectedIssue(issue)
                  setDrawerOpen(true)
                }}
              />
            </TabsContent>
            <TabsContent value="duplicates" className="mt-4">
              <IssueTable
                rows={duplicates}
                onSelect={(issue) => {
                  setSelectedIssue(issue)
                  setDrawerOpen(true)
                }}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <DocumentDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={selectedIssue?.fileName ?? 'Issue detail'}
        subtitle={selectedIssue?.id}
        status={selectedIssue?.type}
        stage="Needs review"
        nextStep="Review + reprocess decision"
        meta={
          selectedIssue
            ? [
                { label: 'Reason', value: selectedIssue.reason },
                { label: 'Severity', value: selectedIssue.severity },
                { label: 'Owner', value: selectedIssue.owner },
                { label: 'Updated', value: selectedIssue.updatedAt },
              ]
            : undefined
        }
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
        openTo={
          selectedIssue?.fileName
            ? `/documents/${encodeURIComponent(selectedIssue.fileName)}`
            : undefined
        }
      />
    </AppShell>
  )
}

function IssueTable({
  rows,
  onSelect,
}: {
  rows: typeof issueQueue
  onSelect: (issue: (typeof issueQueue)[number]) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Issue ID</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>File</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead className="text-right">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((issue) => (
          <TableRow
            key={issue.id}
            tabIndex={0}
            onClick={() => onSelect(issue)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(issue)
              }
            }}
            className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            title="View issue detail"
          >
            <TableCell className="font-medium">{issue.id}</TableCell>
            <TableCell>
              <StatusPill status={issue.type} />
            </TableCell>
            <TableCell>{issue.fileName}</TableCell>
            <TableCell>{issue.reason}</TableCell>
            <TableCell>
              <Badge variant="outline" className="gap-1">
                <IconAlertTriangle className="size-3" />
                {issue.severity}
              </Badge>
            </TableCell>
            <TableCell>{issue.owner}</TableCell>
            <TableCell className="text-right text-muted-foreground">
              {issue.updatedAt}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
