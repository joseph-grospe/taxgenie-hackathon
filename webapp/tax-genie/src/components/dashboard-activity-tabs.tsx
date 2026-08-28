'use client'

import type {
  DashboardBatchRow,
  DashboardRecentBatchesFilterOptions,
  DashboardValidatedDocumentsFilterOptions,
} from '@/lib/dashboard-types'
import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import type { ValidatedTableRow } from '@/lib/validated-table-model'
import { DashboardBatchesTable } from '@/components/dashboard-batches-table'
import { DashboardValidatedDocumentsTable } from '@/components/dashboard-validated-documents-table'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DASHBOARD_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'

export function DashboardActivityTabs({
  batches,
  batchFilterOptions,
  validatedDocuments,
  validatedFilterOptions,
  validatedSearch,
  onValidatedSearchChange,
  loading = false,
}: {
  batches: Array<DashboardBatchRow>
  batchFilterOptions: DashboardRecentBatchesFilterOptions
  validatedDocuments: Array<ValidatedTableRow>
  validatedFilterOptions: DashboardValidatedDocumentsFilterOptions
  validatedSearch: ValidatedRouteSearch
  onValidatedSearchChange: (patch: Partial<ValidatedRouteSearch>) => void
  loading?: boolean
}) {
  return (
    <Card size="sm" className="gap-0 py-0 shadow-none ring-0">
      <Tabs defaultValue="batches" className="gap-0">
        <CardHeader className="border-b border-border/60 py-0">
          <TabsList
            variant="line"
            aria-label="Dashboard activity"
            className="h-auto max-w-full justify-start gap-4 overflow-x-auto rounded-none p-0"
          >
            <TabsTrigger
              value="batches"
              className="h-10 flex-none px-0 text-sm"
            >
              Recent Batches · {batches.length.toLocaleString()}
            </TabsTrigger>
            <TabsTrigger
              value="validated"
              className="h-10 flex-none px-0 text-sm"
              {...getProductTourTargetProps(
                DASHBOARD_TOUR_TARGETS.validatedDocuments,
              )}
            >
              Validated Documents · {validatedDocuments.length.toLocaleString()}
            </TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent className="px-0">
          <TabsContent value="batches" keepMounted>
            <DashboardBatchesTable
              rows={batches}
              filterOptions={batchFilterOptions}
              loading={loading}
              presentation="embedded"
            />
          </TabsContent>
          <TabsContent value="validated" keepMounted>
            <DashboardValidatedDocumentsTable
              rows={validatedDocuments}
              filterOptions={validatedFilterOptions}
              search={validatedSearch}
              onSearchChange={onValidatedSearchChange}
              loading={loading}
              presentation="embedded"
            />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  )
}
