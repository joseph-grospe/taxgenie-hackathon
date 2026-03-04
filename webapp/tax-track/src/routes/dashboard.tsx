import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { CSSProperties } from 'react'

import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import { parseValidatedSearch } from '@/lib/validated-search-state'

import { AppSidebar } from '@/components/app-sidebar'
import { ValidatedDocumentsPanel } from '@/components/validated-documents-panel'
import { ChartAreaInteractive } from '@/components/chart-area-interactive'
import { DataTable } from '@/components/data-table'
import { SectionCards } from '@/components/section-cards'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

import { recentBatches } from '@/data/mock-data'

export const Route = createFileRoute('/dashboard')({
  validateSearch: (search) => parseValidatedSearch(search),
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()

  const updateSearch = (patch: Partial<ValidatedRouteSearch>) => {
    void navigate({
      search: (previous) => parseValidatedSearch({ ...previous, ...patch }),
      replace: true,
    })
  }

  const tableData = recentBatches.map((batch, index) => ({
    id: index + 1,
    header: batch.id,
    type: batch.period,
    status: batch.status,
    target: String(batch.files),
    limit: String(batch.errors),
    reviewer: batch.owner,
  }))

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader title="Dashboard" subtitle="Operational overview" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6">
                <ValidatedDocumentsPanel
                  search={search}
                  onSearchChange={updateSearch}
                  controlPlacement="top-right"
                />
              </div>
              <SectionCards />
              <div className="px-4 lg:px-6">
                <ChartAreaInteractive />
              </div>
              <DataTable data={tableData} />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
