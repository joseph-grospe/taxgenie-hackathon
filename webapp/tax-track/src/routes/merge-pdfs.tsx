import { createFileRoute } from '@tanstack/react-router'

import { AppShell } from '@/components/app-shell'
import { SignedPdfMergePanel } from '@/components/signed-pdf-merge-panel'
import { authClient } from '@/lib/auth-client'
import { canExport, parseSessionContext } from '@/lib/access-control'

export const Route = createFileRoute('/merge-pdfs')({
  component: RouteComponent,
})

function RouteComponent() {
  const { data: session } = authClient.useSession()
  const context = session?.user ? parseSessionContext(session.user) : null
  const canExportPdf = Boolean(
    context && canExport.pdf(context.role, context.canExportPdf),
  )

  return (
    <AppShell
      title="Merge PDFs"
      subtitle="Merge signed 2307 forms into EAFS-ready PDF batches"
    >
      <SignedPdfMergePanel canExportPdf={canExportPdf} />
    </AppShell>
  )
}
