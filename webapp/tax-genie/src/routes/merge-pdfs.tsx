import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { AppShell } from '@/components/app-shell'
import { MergePdfsTour } from '@/components/product-tour'
import { SignedPdfMergePanel } from '@/components/signed-pdf-merge-panel'
import { authClient } from '@/lib/auth-client'
import { canExport, parseSessionContext } from '@/lib/access-control'
import { MERGE_PDFS_TOUR_TARGETS } from '@/lib/product-tours'
import { productFeatures } from '@/lib/product-features'

export const Route = createFileRoute('/merge-pdfs')({
  component: RouteComponent,
})

function RouteComponent() {
  const { data: session } = authClient.useSession()
  const [tourStartSignal, setTourStartSignal] = useState(0)
  const context = session?.user ? parseSessionContext(session.user) : null
  const canExportPdf = Boolean(
    context && canExport.pdf(context.role, context.canExportPdf),
  )

  if (!productFeatures.merge) {
    return (
      <AppShell title="PDF Merge" subtitle="Unavailable in this deployment">
        <p className="text-muted-foreground text-sm">
          PDF merge is deferred for the current GCP release.
        </p>
      </AppShell>
    )
  }

  return (
    <AppShell
      title="Merge PDFs"
      subtitle="Merge signed 2307 forms into EAFS-ready PDF batches"
      pageHelp={
        canExportPdf
          ? {
              label: 'Guide me through this page',
              onStartTour: () => setTourStartSignal((current) => current + 1),
            }
          : undefined
      }
      tourTargets={
        canExportPdf
          ? {
              title: MERGE_PDFS_TOUR_TARGETS.title,
            }
          : undefined
      }
    >
      <SignedPdfMergePanel
        canExportPdf={canExportPdf}
        tourTargets={
          canExportPdf
            ? {
                controls: MERGE_PDFS_TOUR_TARGETS.controls,
                preview: MERGE_PDFS_TOUR_TARGETS.preview,
                recentJobs: MERGE_PDFS_TOUR_TARGETS.recentJobs,
                submitActions: MERGE_PDFS_TOUR_TARGETS.submitActions,
                summary: MERGE_PDFS_TOUR_TARGETS.summary,
                workflow: MERGE_PDFS_TOUR_TARGETS.workflow,
              }
            : undefined
        }
      />
      {canExportPdf ? <MergePdfsTour startSignal={tourStartSignal} /> : null}
    </AppShell>
  )
}
