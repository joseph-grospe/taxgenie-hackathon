import { IconDownload } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

import type { OperationalDocumentView } from '@/lib/documents-types'
import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { ValidatedDocumentsPanel } from '@/components/validated-documents-panel'
import { authClient } from '@/lib/auth-client'
import { canExport, parseSessionContext } from '@/lib/access-control'
import { parseValidatedSearch } from '@/lib/validated-search-state'

export const Route = createFileRoute('/validated')({
  validateSearch: (search) => parseValidatedSearch(search),
  component: RouteComponent,
})

const POLL_INTERVAL_MS = 8_000

type DocumentsResponse = {
  documents?: Array<OperationalDocumentView>
  error?: string
}

function RouteComponent() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const { data: session } = authClient.useSession()
  const [documents, setDocuments] = useState<Array<OperationalDocumentView>>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const context = session?.user ? parseSessionContext(session.user) : null

  const canExportSelected = Boolean(
    context &&
      (canExport.pdf(context.role, context.canExportPdf) ||
        canExport.excel(context.role, context.canExportExcel)),
  )
  const canDownloadSignedPdf = Boolean(
    context && canExport.pdf(context.role, context.canExportPdf),
  )

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

      const payload = (await response.json().catch(() => null)) as
        | DocumentsResponse
        | null

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
      actions={
        <Button size="sm" disabled={!canExportSelected}>
          <IconDownload className="size-4" />
          Export selected
        </Button>
      }
    >
      {loadError ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
          {loadError}
        </div>
      ) : null}
      <ValidatedDocumentsPanel
        search={search}
        onSearchChange={updateSearch}
        documents={documents}
        canDownloadSignedPdf={canDownloadSignedPdf}
      />
    </AppShell>
  )
}
