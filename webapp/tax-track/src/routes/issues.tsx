import { createFileRoute } from '@tanstack/react-router'
import { IconAlertTriangle, IconCopy, IconFileAlert } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Icon } from '@tabler/icons-react'

import type { OperationalDocumentView } from '@/lib/documents-types'
import { AppShell } from '@/components/app-shell'
import { DocumentDetailDrawer } from '@/components/document-detail-drawer'
import { StatusPill } from '@/components/status-pill'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/issues')({
  component: RouteComponent,
})

const POLL_INTERVAL_MS = 8_000
const PANEL_CARD_CLASS = 'border border-border/70 shadow-sm'
const PANEL_BORDER_CLASS = 'border-border/70'

type DocumentsResponse = {
  documents?: Array<OperationalDocumentView>
  error?: string
}

function SummaryTile({
  icon: IconComponent,
  label,
  value,
  description,
}: {
  icon: Icon
  label: string
  value: number
  description: string
}) {
  return (
    <Card size="sm" className={PANEL_CARD_CLASS}>
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <IconComponent className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold leading-none">{value}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
  )
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
    documents.find((document) => document.id === selectedId) ??
    (documents.length > 0 ? documents[0] : undefined)

  return (
    <AppShell
      title="Issues Queue"
      subtitle="Duplicates and validation failures"
    >
      <div className="flex flex-col gap-4">
        {loadError ? (
          <Alert variant="destructive" className="rounded-lg">
            <IconAlertTriangle />
            <AlertTitle>Unable to load issues queue</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-2 md:grid-cols-3">
          <SummaryTile
            icon={IconFileAlert}
            label="Issues"
            value={documents.length}
            description="Total flagged records"
          />
          <SummaryTile
            icon={IconAlertTriangle}
            label="Errors"
            value={errors.length}
            description="Validation failures"
          />
          <SummaryTile
            icon={IconCopy}
            label="Duplicates"
            value={duplicates.length}
            description="Duplicate uploads"
          />
        </div>

        <Card size="sm" className={PANEL_CARD_CLASS}>
          <CardHeader className={cn('gap-3 border-b', PANEL_BORDER_CLASS)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">Duplicates & errors</CardTitle>
                <CardDescription className="text-xs">
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
          <CardContent className="flex flex-col gap-3">
            <Tabs defaultValue="all" className="gap-3">
              <TabsList
                className={cn(
                  'w-full justify-start overflow-x-auto rounded-lg border p-1 sm:w-fit',
                  PANEL_BORDER_CLASS,
                )}
              >
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="errors">Errors</TabsTrigger>
                <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
              </TabsList>
              <TabsContent value="all">
                <IssueTable
                  rows={documents}
                  emptyMessage="No duplicates or validation failures yet."
                  onSelect={(issue) => {
                    setSelectedId(issue.id)
                    setDrawerOpen(true)
                  }}
                />
              </TabsContent>
              <TabsContent value="errors">
                <IssueTable
                  rows={errors}
                  emptyMessage="No validation failures found."
                  onSelect={(issue) => {
                    setSelectedId(issue.id)
                    setDrawerOpen(true)
                  }}
                />
              </TabsContent>
              <TabsContent value="duplicates">
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
      </div>

      {selectedIssue ? (
        <DocumentDetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={selectedIssue.fileName}
          subtitle={selectedIssue.issueReason}
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
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-background',
        PANEL_BORDER_CLASS,
      )}
    >
      <Table className="min-w-[760px] text-xs [&_td]:px-2 [&_td]:py-2 [&_th]:h-8 [&_th]:px-2">
        <TableHeader className="[&_tr]:border-border/70">
          <TableRow className="bg-muted/35 hover:bg-muted/35">
            <TableHead className="w-[18rem] bg-muted/35">File</TableHead>
            <TableHead className="bg-muted/35">Type</TableHead>
            <TableHead className="bg-muted/35">Reason</TableHead>
            <TableHead className="bg-muted/35">Severity</TableHead>
            <TableHead className="bg-muted/35">Owner</TableHead>
            <TableHead className="bg-muted/35 text-right">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr:last-child]:border-b-0">
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
              className="cursor-pointer border-border/70 bg-background hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              title="View issue detail"
            >
              <TableCell className="max-w-[18rem] truncate font-medium">
                {issue.fileName}
              </TableCell>
              <TableCell>
                <StatusPill status={issue.status} />
              </TableCell>
              <TableCell className="max-w-[22rem] truncate text-muted-foreground">
                {issue.issueReason}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="gap-1">
                  <IconAlertTriangle className="size-3" />
                  {issue.severity}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {issue.owner}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {issue.updatedAt}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}
