import { Link, createFileRoute } from '@tanstack/react-router'
import { IconArrowLeft } from '@tabler/icons-react'

import { AppShell } from '@/components/app-shell'
import { DocumentSigningPage } from '@/components/document-signing-page'
import { authClient } from '@/lib/auth-client'
import { canExport, parseSessionContext } from '@/lib/access-control'
import { buttonVariants } from '@/components/ui/button'

export const Route = createFileRoute('/upload/batches/$batchId/sign')({
  component: RouteComponent,
})

function RouteComponent() {
  const { batchId } = Route.useParams()
  const { data: authSession } = authClient.useSession()
  const context = authSession?.user
    ? parseSessionContext(authSession.user)
    : null
  const canDownloadSignedPdf = Boolean(
    context && canExport.pdf(context.role, context.canExportPdf),
  )

  return (
    <AppShell
      title="Sign batch"
      leadingActions={
        <Link
          to="/upload/batches/$batchId"
          params={{ batchId }}
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
