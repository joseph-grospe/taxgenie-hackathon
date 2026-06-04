import { Link, createFileRoute } from '@tanstack/react-router'
import { IconArrowLeft } from '@tabler/icons-react'

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
    >
      <DocumentSigningPage
        batchId={batchId}
        canDownloadSignedPdf={canDownloadSignedPdf}
      />
    </AppShell>
  )
}
