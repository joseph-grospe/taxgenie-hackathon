import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { IconArrowLeft } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { OperationalDocumentView } from '@/lib/documents-types'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import {
  DocumentDetailPage,
  getDocumentBackTo,
} from '@/components/document-detail-page'

type DocumentResponse = {
  document?: OperationalDocumentView
  error?: string
}

type DocumentDetailSearch = {
  from?: string
}

export const Route = createFileRoute('/documents/$docId')({
  validateSearch: (search): DocumentDetailSearch => ({
    from: typeof search.from === 'string' ? search.from : undefined,
  }),
  component: RouteComponent,
})

function RouteComponent() {
  const { docId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const [document, setDocument] = useState<OperationalDocumentView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isResolvingAttention, setIsResolvingAttention] = useState(false)
  const backTo = getDocumentBackTo(document)

  const refreshDocument = useCallback(async () => {
    setIsLoading(true)

    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(docId)}`,
        {
          cache: 'no-store',
        },
      )

      const payload = (await response
        .json()
        .catch(() => null)) as DocumentResponse | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load document detail (${response.status}).`,
        )
      }

      setDocument(payload?.document ?? null)
      setLoadError(null)
    } catch (error) {
      setDocument(null)
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load document detail.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [docId])

  useEffect(() => {
    void refreshDocument()
  }, [refreshDocument])

  const handleBack = useCallback(() => {
    if (search.from === 'error-detail') {
      void navigate({ to: '/upload' })
      return
    }

    if (typeof window !== 'undefined') {
      const referrer = globalThis.document.referrer

      if (referrer) {
        const referrerUrl = new URL(referrer, window.location.origin)

        if (
          referrerUrl.origin === window.location.origin &&
          window.history.length > 1
        ) {
          window.history.back()
          return
        }
      }
    }

    void navigate({ to: backTo })
  }, [backTo, navigate, search.from])

  const handleResolveAttention = useCallback(async () => {
    if (!document?.uploadId || isResolvingAttention) {
      return
    }

    setIsResolvingAttention(true)

    try {
      const response = await fetch('/api/uploads/resolve-attention', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ uploadId: document.uploadId }),
      })

      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to resolve upload issue (${response.status}).`,
        )
      }

      await refreshDocument()
      toast.success('Upload removed from Needs Attention.')
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to resolve upload issue.',
      )
    } finally {
      setIsResolvingAttention(false)
    }
  }, [document?.uploadId, isResolvingAttention, refreshDocument])

  return (
    <AppShell
      title="Document Detail"
      subtitle="Review upload progress, validation outcomes, issue details, and generated certificate results."
      leadingActions={
        <Button type="button" size="sm" variant="outline" onClick={handleBack}>
          <IconArrowLeft data-icon="inline-start" />
          Back
        </Button>
      }
    >
      <DocumentDetailPage
        document={document}
        isLoading={isLoading}
        loadError={loadError}
        isResolvingAttention={isResolvingAttention}
        onResolveAttention={handleResolveAttention}
      />
    </AppShell>
  )
}
