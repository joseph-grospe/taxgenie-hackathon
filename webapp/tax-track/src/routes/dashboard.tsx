import {
  IconAlertTriangle,
  IconCalendar,
  IconRefresh,
} from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import type { DashboardPeriodSearch } from '@/lib/dashboard-period'
import type { DashboardSummary } from '@/lib/dashboard-types'
import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import {
  buildDashboardSummaryQueryParams,
  getDashboardPeriodOptions,
  getDefaultDashboardPeriod,
  getDefaultDashboardTrendGroup,
  parseDashboardSearch,
} from '@/lib/dashboard-period'
import { parseValidatedSearch } from '@/lib/validated-search-state'

import { AppSidebar } from '@/components/app-sidebar'
import { ChartAreaInteractive } from '@/components/chart-area-interactive'
import { DashboardBatchesTable } from '@/components/dashboard-batches-table'
import { DashboardCollectionSummaryCard } from '@/components/dashboard-collection-summary'
import { DashboardMetricBand } from '@/components/dashboard-metric-band'
import { DashboardValidatedDocumentsTable } from '@/components/dashboard-validated-documents-table'
import { EntityScopeSelect } from '@/components/entity-scope-select'
import { useEntityScope } from '@/components/entity-scope-provider'
import { DashboardTour } from '@/components/product-tour'
import { SiteHeader } from '@/components/site-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  DASHBOARD_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { toValidatedTableRowsFromOperationalDocuments } from '@/lib/validated-table-model'

const POLL_INTERVAL_MS = 30_000

type DashboardSummaryResponse = DashboardSummary & {
  error?: string
}

const LAST_UPDATED_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Manila',
})

const parseDashboardRouteSearch = (search: Record<string, unknown>) => ({
  ...parseValidatedSearch({ ...search, entity: '' }),
  entity: '',
  ...parseDashboardSearch(search),
})

const formatLastUpdated = (value?: string) => {
  if (!value) return 'Not updated yet'

  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Not updated yet'
    : LAST_UPDATED_FORMATTER.format(date)
}

export const Route = createFileRoute('/dashboard')({
  validateSearch: (search) => parseDashboardRouteSearch(search),
  component: RouteComponent,
})

function DashboardPeriodControls({
  search,
  onPeriodChange,
}: {
  search: DashboardPeriodSearch
  onPeriodChange: (patch: Partial<DashboardPeriodSearch>) => void
}) {
  const periodOptions = useMemo(
    () => getDashboardPeriodOptions(search.periodType, search.period),
    [search.period, search.periodType],
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        value={[search.periodType]}
        onValueChange={(values) => {
          const value = values.at(-1)

          if (
            value !== 'monthly' &&
            value !== 'quarterly' &&
            value !== 'yearly'
          ) {
            return
          }

          onPeriodChange({
            periodType: value,
            period: getDefaultDashboardPeriod(value),
            trendGroup: getDefaultDashboardTrendGroup(value),
          })
        }}
        variant="outline"
        size="sm"
      >
        <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
        <ToggleGroupItem value="quarterly">Quarterly</ToggleGroupItem>
        <ToggleGroupItem value="yearly">Yearly</ToggleGroupItem>
      </ToggleGroup>
      <div className="flex items-center overflow-hidden rounded-md border bg-input/30">
        <Select
          value={search.period}
          onValueChange={(period) => {
            if (period) {
              onPeriodChange({ period })
            }
          }}
        >
          <SelectTrigger size="sm" className="w-40 border-0 bg-transparent">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {periodOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="flex h-8 items-center border-l px-2.5 text-muted-foreground">
          <IconCalendar />
        </div>
      </div>
    </div>
  )
}

function RouteComponent() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const { entityById } = useEntityScope()
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [tourStartSignal, setTourStartSignal] = useState(0)

  const updateSearch = (patch: Partial<ValidatedRouteSearch>) => {
    void navigate({
      search: (previous) =>
        parseDashboardRouteSearch({ ...previous, ...patch }),
      replace: true,
    })
  }

  const updatePeriodSearch = (patch: Partial<DashboardPeriodSearch>) => {
    void navigate({
      search: (previous) =>
        parseDashboardRouteSearch({ ...previous, ...patch }),
      replace: true,
    })
  }

  const refreshDashboard = useCallback(async () => {
    setIsLoading(true)

    try {
      const params = buildDashboardSummaryQueryParams({
        periodType: search.periodType,
        period: search.period,
        trendGroup: search.trendGroup,
        entityId: search.entityId,
      })
      const response = await fetch(`/api/dashboard/summary?${params}`, {
        cache: 'no-store',
      })
      const payload = (await response
        .json()
        .catch(() => null)) as DashboardSummaryResponse | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load dashboard analytics (${response.status}).`,
        )
      }

      if (!payload) {
        throw new Error('Dashboard analytics response was empty.')
      }

      setSummary(payload)
      setLoadError(null)
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load dashboard analytics.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [search.entityId, search.period, search.periodType, search.trendGroup])

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshDashboard()
      }
    }
    const handleVisibilityChange = () => {
      refreshIfVisible()
    }

    void refreshDashboard()
    const interval = window.setInterval(refreshIfVisible, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshDashboard])

  const validatedRows = useMemo(
    () =>
      toValidatedTableRowsFromOperationalDocuments(
        summary?.validatedDocuments ?? [],
      ),
    [summary?.validatedDocuments],
  )
  const selectedEntityLabel = useMemo(() => {
    if (!search.entityId) return null

    return entityById.get(search.entityId)?.label ?? `Entity ${search.entityId}`
  }, [entityById, search.entityId])
  const reportingLabel = summary
    ? selectedEntityLabel
      ? `${summary.period.label} - ${selectedEntityLabel}`
      : summary.period.label
    : 'Loading live dashboard data'

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
        <SiteHeader
          title="Dashboard"
          subtitle={
            summary
              ? `BIR 2307 processing and collection for ${reportingLabel}`
              : 'BIR 2307 processing and collection'
          }
          entityScope={<EntityScopeSelect />}
          pageHelp={{
            label: 'Guide me through the dashboard',
            onStartTour: () => setTourStartSignal((current) => current + 1),
          }}
          tourTargets={{
            actions: DASHBOARD_TOUR_TARGETS.actions,
            entityScope: DASHBOARD_TOUR_TARGETS.entityScope,
            help: DASHBOARD_TOUR_TARGETS.help,
            sidebarTrigger: DASHBOARD_TOUR_TARGETS.sidebarTrigger,
            title: DASHBOARD_TOUR_TARGETS.title,
          }}
          actions={
            <>
              <Button
                size="icon-sm"
                variant="outline"
                onClick={() => void refreshDashboard()}
                aria-label="Refresh dashboard"
              >
                <IconRefresh />
              </Button>
              <div className="hidden text-xs leading-tight text-muted-foreground md:block">
                <p>Last updated</p>
                <p className="font-medium text-foreground">
                  {formatLastUpdated(summary?.generatedAt)}
                </p>
              </div>
            </>
          }
        />
        <div
          className="border-b bg-muted/20 px-4 py-2 lg:px-6"
          {...getProductTourTargetProps(DASHBOARD_TOUR_TARGETS.reportingPeriod)}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reporting Period
              </p>
              <p className="text-sm font-medium">{reportingLabel}</p>
            </div>
            <DashboardPeriodControls
              search={search}
              onPeriodChange={updatePeriodSearch}
            />
          </div>
        </div>
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-3 px-4 py-4 lg:px-6">
              {loadError ? (
                <Alert variant="destructive" className="rounded-lg">
                  <IconAlertTriangle />
                  <AlertTitle>Unable to load dashboard</AlertTitle>
                  <AlertDescription>{loadError}</AlertDescription>
                </Alert>
              ) : null}
              <div
                {...getProductTourTargetProps(DASHBOARD_TOUR_TARGETS.metrics)}
              >
                <DashboardMetricBand
                  groups={summary?.metricGroups ?? []}
                  loading={isLoading && !summary}
                />
              </div>
              <div
                className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)]"
                {...getProductTourTargetProps(DASHBOARD_TOUR_TARGETS.trend)}
              >
                <div className="min-w-0">
                  <ChartAreaInteractive
                    data={summary?.trend ?? []}
                    period={summary?.period}
                    trendGroup={search.trendGroup}
                    onTrendGroupChange={(trendGroup) =>
                      updatePeriodSearch({ trendGroup })
                    }
                    loading={isLoading && !summary}
                  />
                </div>
                <div
                  className="min-w-0"
                  {...getProductTourTargetProps(
                    DASHBOARD_TOUR_TARGETS.collection,
                  )}
                >
                  <DashboardCollectionSummaryCard
                    summary={summary?.collectionSummary}
                    loading={isLoading && !summary}
                  />
                </div>
              </div>
              <div
                className="grid gap-3 xl:grid-cols-2"
                {...getProductTourTargetProps(
                  DASHBOARD_TOUR_TARGETS.recentBatches,
                )}
              >
                <div className="h-full min-w-0">
                  <DashboardBatchesTable
                    rows={summary?.recentBatches ?? []}
                    loading={isLoading && !summary}
                  />
                </div>
                <div
                  className="h-full min-w-0"
                  {...getProductTourTargetProps(
                    DASHBOARD_TOUR_TARGETS.validatedDocuments,
                  )}
                >
                  <DashboardValidatedDocumentsTable
                    rows={validatedRows}
                    search={search}
                    onSearchChange={updateSearch}
                    loading={isLoading && !summary}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <DashboardTour startSignal={tourStartSignal} />
      </SidebarInset>
    </SidebarProvider>
  )
}
