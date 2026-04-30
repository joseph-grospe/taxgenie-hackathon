import { Link, createFileRoute } from '@tanstack/react-router'
import { IconArrowLeft } from '@tabler/icons-react'

import { AppShell } from '@/components/app-shell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'

export const Route = createFileRoute('/documents/$docId/sign')({
  component: RouteComponent,
})

function RouteComponent() {
  const { docId } = Route.useParams()

  return (
    <AppShell
      title="Signing unavailable"
      leadingActions={
        <Link
          to="/documents/$docId"
          params={{ docId }}
          replace
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
        >
          <IconArrowLeft data-icon="inline-start" />
          Back to document
        </Link>
      }
      showSupportAction={false}
    >
      <Alert>
        <AlertTitle>Signing moved to upload batches.</AlertTitle>
        <AlertDescription>
          Open the closed upload batch for this document to sign its ready
          certificates.
        </AlertDescription>
      </Alert>
    </AppShell>
  )
}
