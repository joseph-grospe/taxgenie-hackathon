import {
  IconAlertTriangle,
  IconFileCheck,
  IconSignature,
  IconStack2,
} from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import type { Icon } from '@tabler/icons-react'

import type { OperationalDocumentView } from '@/lib/documents-types'
import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import { AppShell } from '@/components/app-shell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { ValidatedDocumentsPanel } from '@/components/validated-documents-panel'
import { authClient } from '@/lib/auth-client'
import { canExport, parseSessionContext } from '@/lib/access-control'
import { parseValidatedSearch } from '@/lib/validated-search-state'

export const Route = createFileRoute('/validated')({
  validateSearch: (search) => parseValidatedSearch(search),
  component: RouteComponent,
})

const POLL_INTERVAL_MS = 8_000
const PANEL_CARD_CLASS = 'border border-border/70 shadow-sm'

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
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const { data: session } = authClient.useSession()
  const [documents, setDocuments] = useState<Array<OperationalDocumentView>>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const context = session?.user ? parseSessionContext(session.user) : null

  const canDownloadSignedPdf = Boolean(
    context && canExport.pdf(context.role, context.canExportPdf),
  )
  const certificateCount = documents.filter(
    (document) => document.kind === 'certificate',
  ).length
  const signedCount = documents.filter(
    (document) => document.signingStatus === 'signed',
  ).length

  const updateSearch = (patch: Partial<ValidatedRouteSearch>) => {
    void navigate({
      search: (previous) => parseValidatedSearch({ ...previous, ...patch }),
      replace: true,
    })
  }

  const refreshDocuments = useCallback(async () => {
    try {
      const response = await fetch('/api/documents/validated', {
        cache: 'no-store',
      })

      const payload = (await response
        .json()
        .catch(() => null)) as DocumentsResponse | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load validated documents (${response.status}).`,
        )
      }

      setDocuments(Array.isArray(payload?.documents) ? payload.documents : [])
      setLoadError(null)
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load validated documents.',
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

  return (
    <AppShell
      title="Validated Results"
      subtitle="Ready-to-export 2307 extractions"
    >
      <div className="flex flex-col gap-4">
        {loadError ? (
          <Alert variant="destructive" className="rounded-lg">
            <IconAlertTriangle />
            <AlertTitle>Unable to load validated documents</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-2 md:grid-cols-3">
          <SummaryTile
            icon={IconFileCheck}
            label="Validated"
            value={documents.length}
            description="Ready records"
          />
          <SummaryTile
            icon={IconStack2}
            label="Certificates"
            value={certificateCount}
            description="2307 documents"
          />
          <SummaryTile
            icon={IconSignature}
            label="Signed PDFs"
            value={signedCount}
            description="Ready downloads"
          />
        </div>

        <ValidatedDocumentsPanel
          search={search}
          onSearchChange={updateSearch}
          documents={documents}
          canDownloadSignedPdf={canDownloadSignedPdf}
        />
      </div>
    </AppShell>
  )
}
