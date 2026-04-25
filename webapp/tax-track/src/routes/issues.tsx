import { createFileRoute } from '@tanstack/react-router'
import { IconAlertTriangle, IconCopy, IconFileAlert } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { OperationalDocumentView } from '@/lib/documents-types'
import { AppShell } from '@/components/app-shell'
import { DocumentDetailDrawer } from '@/components/document-detail-drawer'
import { StatusPill } from '@/components/status-pill'
import { Badge } from '@/components/ui/badge'
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

export const Route = createFileRoute('/issues')({
  component: RouteComponent,
})

const POLL_INTERVAL_MS = 8_000

type DocumentsResponse = {
  documents?: Array<OperationalDocumentView>
  error?: string
}

function RouteComponent() {
  const [documents, setDocuments] = useState<Array<OperationalDocumentView>>([])
  const [selectedId, setSelectedId] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refreshDocuments = useCallback(async () => {
    try {
      const response = await fetch('/api/documents/issues', {
        cache: 'no-store',
      })

      const payload = (await response
        .json()
        .catch(() => null)) as DocumentsResponse | null

      if (!response.ok) {
        throw new Error(
          payload?.error || `Failed to load issues queue (${response.status}).`,
        )
      }

      setDocuments(Array.isArray(payload?.documents) ? payload.documents : [])
      setLoadError(null)
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load issues queue.',
      )
    }
  }, [])

  useEffect(() => {
    void refreshDocuments()
    const interval = window.setInterval(() => {
      void refreshDocuments()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [refreshDocuments])

  useEffect(() => {
    if (documents.length === 0) {
      setSelectedId('')
      setDrawerOpen(false)
      return
    }

    if (!documents.some((document) => document.id === selectedId)) {
      setSelectedId(documents[0].id)
    }
  }, [documents, selectedId])

  const errors = useMemo(
    () => documents.filter((document) => document.status === 'Error'),
    [documents],
  )
  const duplicates = useMemo(
    () => documents.filter((document) => document.status === 'Duplicate'),
    [documents],
  )
  const selectedIssue =
    documents.find((document) => document.id === selectedId) ?? documents[0]

  return (
    <AppShell
      title="Issues Queue"
      subtitle="Duplicates and validation failures"
    >
      {loadError ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Duplicates & errors</CardTitle>
              <CardDescription>
                Review upload outputs that were flagged by validation or
                deduplication.
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
                rows={documents}
                emptyMessage="No duplicates or validation failures yet."
                onSelect={(issue) => {
                  setSelectedId(issue.id)
                  setDrawerOpen(true)
                }}
              />
            </TabsContent>
            <TabsContent value="errors" className="mt-4">
              <IssueTable
                rows={errors}
                emptyMessage="No validation failures found."
                onSelect={(issue) => {
                  setSelectedId(issue.id)
                  setDrawerOpen(true)
                }}
              />
            </TabsContent>
            <TabsContent value="duplicates" className="mt-4">
              <IssueTable
                rows={duplicates}
                emptyMessage="No duplicates found."
                onSelect={(issue) => {
                  setSelectedId(issue.id)
                  setDrawerOpen(true)
                }}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {selectedIssue ? (
        <DocumentDetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={selectedIssue.fileName}
          subtitle={selectedIssue.id}
          status={selectedIssue.status}
          stage={selectedIssue.stage}
          nextStep={selectedIssue.nextStep}
          confidence={selectedIssue.confidence}
          atc={selectedIssue.atc}
          payee={selectedIssue.payee}
          meta={[
            { label: 'Reason', value: selectedIssue.issueReason },
            { label: 'Severity', value: selectedIssue.severity },
            { label: 'Owner', value: selectedIssue.owner },
            { label: 'Updated', value: selectedIssue.updatedAt },
          ]}
          processing={selectedIssue.processing}
          trail={selectedIssue.trail}
          logs={selectedIssue.logs}
          errors={selectedIssue.errors}
          openTo={`/documents/${selectedIssue.id}`}
        />
      ) : null}
    </AppShell>
  )
}

function IssueTable({
  rows,
  emptyMessage,
  onSelect,
}: {
  rows: Array<OperationalDocumentView>
  emptyMessage: string
  onSelect: (issue: OperationalDocumentView) => void
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
              <StatusPill status={issue.status} />
            </TableCell>
            <TableCell>{issue.fileName}</TableCell>
            <TableCell>{issue.issueReason}</TableCell>
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
        {rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={7}
              className="h-20 text-center text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  )
}
