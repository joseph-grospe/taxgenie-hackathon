import { IconAlertTriangle, IconCalendar } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import type { DashboardPeriodSearch } from '@/lib/dashboard-period'
import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import type { DashboardSummary } from '@/lib/dashboard-types'
import { buildDashboardFilterOptions } from '@/lib/dashboard-types'
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
import { DashboardActivityTabs } from '@/components/dashboard-activity-tabs'
import { DashboardCollectionSummaryCard } from '@/components/dashboard-collection-summary'
import { DashboardMetricBand } from '@/components/dashboard-metric-band'
import { EntityScopeSelect } from '@/components/entity-scope-select'
import { useEntityScope } from '@/components/entity-scope-provider'
import { DashboardTour } from '@/components/product-tour'
import { RefreshStatus } from '@/components/refresh-status'
import { SiteHeader } from '@/components/site-header'
import { preserveScrollDuringNavigation } from '@/hooks/use-preserved-route-search'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  DASHBOARD_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { toValidatedTableRowsFromOperationalDocuments } from '@/lib/validated-table-model'
import { formatPageLastUpdated } from '@/lib/active-polling'

type DashboardSummaryResponse = DashboardSummary & {
  error?: string
}

const DEFAULT_DASHBOARD_FILTER_OPTIONS = buildDashboardFilterOptions()

const parseDashboardRouteSearch = (search: Record<string, unknown>) => ({
  ...parseValidatedSearch({ ...search, entity: '', signingStatus: 'all' }),
  entity: '',
  signingStatus: 'all' as const,
  ...parseDashboardSearch(search),
})

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
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <p className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Reporting period
        </p>
        <Separator
          orientation="vertical"
          className="hidden data-[orientation=vertical]:h-6 sm:block"
        />
        <div className="flex items-center overflow-hidden rounded-md border bg-input/30">
          <div className="flex h-8 items-center border-r px-2.5 text-muted-foreground">
            <IconCalendar />
          </div>
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
            <SelectContent align="start">
              <SelectGroup>
                {periodOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <ToggleGroup
        className="sm:ml-auto"
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
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const [tourStartSignal, setTourStartSignal] = useState(0)

  const updateSearch = (patch: Partial<ValidatedRouteSearch>) => {
    void preserveScrollDuringNavigation(() =>
      navigate({
        search: (previous) =>
          parseDashboardRouteSearch({ ...previous, ...patch }),
        replace: true,
        resetScroll: false,
      }),
    )
  }

  const updatePeriodSearch = (patch: Partial<DashboardPeriodSearch>) => {
    void preserveScrollDuringNavigation(() =>
      navigate({
        search: (previous) =>
          parseDashboardRouteSearch({ ...previous, ...patch }),
        replace: true,
        resetScroll: false,
      }),
    )
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
      setLastRefreshedAt(new Date())
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
    void refreshDashboard()
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
  const lastUpdatedLabel = formatPageLastUpdated(lastRefreshedAt)

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
            <RefreshStatus
              isRefreshing={isLoading}
              lastUpdatedLabel={lastUpdatedLabel}
              refreshLabel="Refresh dashboard"
              onRefresh={() => void refreshDashboard()}
            />
          }
        />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col">
            <div className="flex flex-col gap-3 px-4 py-3 md:gap-4 md:py-4 lg:px-6">
              <div
                className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2 shadow-none"
                {...getProductTourTargetProps(
                  DASHBOARD_TOUR_TARGETS.reportingPeriod,
                )}
              >
                <DashboardPeriodControls
                  search={search}
                  onPeriodChange={updatePeriodSearch}
                />
                <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="size-2 rounded-full bg-primary" />
                  <span>
                    {lastUpdatedLabel === 'Not updated yet'
                      ? lastUpdatedLabel
                      : `Updated ${lastUpdatedLabel}`}
                  </span>
                </div>
              </div>
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
                className="min-w-0"
                {...getProductTourTargetProps(
                  DASHBOARD_TOUR_TARGETS.recentBatches,
                )}
              >
                <DashboardActivityTabs
                  batches={summary?.recentBatches ?? []}
                  batchFilterOptions={
                    summary?.filterOptions.recentBatches ??
                    DEFAULT_DASHBOARD_FILTER_OPTIONS.recentBatches
                  }
                  validatedDocuments={validatedRows}
                  validatedFilterOptions={
                    summary?.filterOptions.validatedDocuments ??
                    DEFAULT_DASHBOARD_FILTER_OPTIONS.validatedDocuments
                  }
                  validatedSearch={search}
                  onValidatedSearchChange={updateSearch}
                  loading={isLoading && !summary}
                />
              </div>
            </div>
          </div>
        </div>
        <DashboardTour startSignal={tourStartSignal} />
      </SidebarInset>
    </SidebarProvider>
  )
}
