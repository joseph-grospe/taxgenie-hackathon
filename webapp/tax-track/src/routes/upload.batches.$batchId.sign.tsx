import { Link, createFileRoute } from '@tanstack/react-router'
import { IconArrowLeft } from '@tabler/icons-react'

import { AppShell } from '@/components/app-shell'
import { DocumentSigningPage } from '@/components/document-signing-page'
import { buttonVariants } from '@/components/ui/button'

export const Route = createFileRoute('/upload/batches/$batchId/sign')({
  component: RouteComponent,
})

function RouteComponent() {
  const { batchId } = Route.useParams()

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
          Back to batch
        </Link>
      }
      showSupportAction={false}
    >
      <DocumentSigningPage batchId={batchId} />
    </AppShell>
  )
}
