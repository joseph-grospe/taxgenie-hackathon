import { Link, createFileRoute } from '@tanstack/react-router'
import { IconArrowLeft } from '@tabler/icons-react'
import { toast } from 'sonner'

import { AppShell } from '@/components/app-shell'
import { DocumentSigningPage } from '@/components/document-signing-page'
import { authClient } from '@/lib/auth-client'
import {
  SIGNING_TEAM_REQUIRED_MESSAGE,
  canAccessRoute,
  canExport,
  canSignCertificates,
  parseSessionContext,
} from '@/lib/access-control'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { defaultBatchDetailSearch } from '@/lib/batch-file-search-state'
import {
  SIGNING_TOUR_RESTART_EVENT,
  SIGNING_TOUR_TARGETS,
} from '@/lib/product-tours'
import { downloadResponseAttachment } from '@/lib/download-client'

export const Route = createFileRoute('/upload/batches/$batchId/sign')({
  component: RouteComponent,
})

function RouteComponent() {
  const { batchId } = Route.useParams()

  return <BatchSigningRouteContent batchId={batchId} />
}

export function BatchSigningRouteContent({ batchId }: { batchId: string }) {
  const { data: authSession, isPending } = authClient.useSession()
  const context = authSession?.user
    ? parseSessionContext(authSession.user)
    : null
  const canDownloadSignedPdf = Boolean(
    context && canExport.pdf(context.role, context.canExportPdf),
  )
  const canAccessSigning = Boolean(
    context &&
    canAccessRoute('upload', context.role) &&
    canSignCertificates(context),
  )
  const shouldShowSigningTour = Boolean(context && canAccessSigning)
  const downloadSignedCertificates = async () => {
    if (!canDownloadSignedPdf) {
      return
    }

    try {
      const response = await fetch(
        `/api/uploads/batches/${encodeURIComponent(
          batchId,
        )}/signed-certificates/export`,
      )

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string
        } | null

        throw new Error(
          payload?.error ||
            `Failed to download signed certificates (${response.status}).`,
        )
      }

      const fileName = await downloadResponseAttachment(
        response,
        'Signed-Certificates.zip',
      )

      toast.success('Signed PDFs ready', {
        description: `${fileName} has been downloaded.`,
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to download signed certificate PDFs.',
      )
    }
  }

  if (!isPending && context && !canAccessSigning) {
    return (
      <AppShell
        title="Sign batch"
        leadingActions={
          <Link
            to="/upload/batches/$batchId"
            params={{ batchId }}
            search={defaultBatchDetailSearch}
            replace
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            <IconArrowLeft data-icon="inline-start" />
            Back
          </Link>
        }
      >
        <Alert>
          <AlertTitle>Signing is restricted.</AlertTitle>
          <AlertDescription>{SIGNING_TEAM_REQUIRED_MESSAGE}</AlertDescription>
        </Alert>
      </AppShell>
    )
  }

  return (
    <AppShell
      title="Sign batch"
      leadingActions={
        <Link
          to="/upload/batches/$batchId"
          params={{ batchId }}
          search={defaultBatchDetailSearch}
          replace
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
        >
          <IconArrowLeft data-icon="inline-start" />
          Back
        </Link>
      }
      pageHelp={
        shouldShowSigningTour
          ? {
              label: 'Guide me through signing',
              onStartTour: () => {
                window.dispatchEvent(
                  new CustomEvent(SIGNING_TOUR_RESTART_EVENT, {
                    detail: { signingId: batchId },
                  }),
                )
              },
            }
          : undefined
      }
      tourTargets={{
        leadingActions: SIGNING_TOUR_TARGETS.backAction,
        title: SIGNING_TOUR_TARGETS.title,
      }}
    >
      <DocumentSigningPage
        batchId={batchId}
        canDownloadSignedPdf={canDownloadSignedPdf}
        onDownloadSignedCertificates={downloadSignedCertificates}
        tourTargets={{
          certificateList: SIGNING_TOUR_TARGETS.certificateList,
          placement: SIGNING_TOUR_TARGETS.placement,
          preview: SIGNING_TOUR_TARGETS.preview,
          previewControls: SIGNING_TOUR_TARGETS.previewControls,
          previewTabs: SIGNING_TOUR_TARGETS.previewTabs,
          profile: SIGNING_TOUR_TARGETS.profile,
          status: SIGNING_TOUR_TARGETS.status,
          summary: SIGNING_TOUR_TARGETS.summary,
          toolbar: SIGNING_TOUR_TARGETS.toolbar,
        }}
      />
    </AppShell>
  )
}
