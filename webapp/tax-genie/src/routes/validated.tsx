import {
  IconAlertTriangle,
  IconFileCheck,
  IconSignature,
  IconStack2,
} from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Icon } from '@tabler/icons-react'

import type { OperationalDocumentView } from '@/lib/documents-types'
import type {
  ValidatedDocumentFilterOptions,
  ValidatedDocumentPagination,
  ValidatedDocumentSummary,
} from '@/lib/documents-server'
import type { ValidatedRouteSearch } from '@/lib/validated-search-state'
import { AppShell } from '@/components/app-shell'
import { ValidatedTour } from '@/components/product-tour'
import { RefreshStatus } from '@/components/refresh-status'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { ValidatedDocumentsPanel } from '@/components/validated-documents-panel'
import { preserveScrollDuringNavigation } from '@/hooks/use-preserved-route-search'
import { authClient } from '@/lib/auth-client'
import {
  canAccessRoute,
  canExport,
  canSignCertificates,
  parseSessionContext,
} from '@/lib/access-control'
import {
  buildValidatedDocumentsQueryParams,
  parseValidatedSearch,
} from '@/lib/validated-search-state'
import {
  VALIDATED_TOUR_TARGETS,
  getProductTourTargetProps,
} from '@/lib/product-tours'
import { formatPageLastUpdated } from '@/lib/active-polling'

export const Route = createFileRoute('/validated')({
  validateSearch: (search) => parseValidatedSearch(search),
  component: RouteComponent,
})

const PANEL_CARD_CLASS = 'rounded-lg border border-border/70 shadow-none ring-0'

type DocumentsResponse = {
  documents?: Array<OperationalDocumentView>
  pagination?: ValidatedDocumentPagination
  summary?: ValidatedDocumentSummary
  filterOptions?: ValidatedDocumentFilterOptions
  error?: string
}

const DEFAULT_PAGINATION: ValidatedDocumentPagination = {
  page: 1,
  pageSize: 25,
  totalItems: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
}

const DEFAULT_SUMMARY: ValidatedDocumentSummary = {
  totalValidated: 0,
  certificateCount: 0,
  signedPdfCount: 0,
}

const DEFAULT_FILTER_OPTIONS: ValidatedDocumentFilterOptions = {
  year: [],
  month: [],
  quarter: [],
  customerType: [],
  errorType: [],
  atc: [],
}

function SummaryTile({
  icon: IconComponent,
  label,
  value,
  description,
}: {
  icon: Icon
  label: string
  value: number
  description: string
}) {
  return (
    <Card size="sm" className={PANEL_CARD_CLASS}>
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <IconComponent className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold leading-none">{value}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function RouteComponent() {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const { data: session } = authClient.useSession()
  const [documents, setDocuments] = useState<Array<OperationalDocumentView>>([])
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION)
  const [summary, setSummary] = useState(DEFAULT_SUMMARY)
  const [filterOptions, setFilterOptions] = useState(DEFAULT_FILTER_OPTIONS)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const [tourStartSignal, setTourStartSignal] = useState(0)

  const context = session?.user ? parseSessionContext(session.user) : null

  const canDownloadSignedPdf = Boolean(
    context && canExport.pdf(context.role, context.canExportPdf),
  )
  const canAccessSigning = Boolean(
    context &&
    canAccessRoute('upload', context.role) &&
    canSignCertificates(context),
  )
  const validatedSearch = useMemo<ValidatedRouteSearch>(() => {
    const hasHiddenSort =
      search.sortBy === 'customerType' || search.sortBy === 'errorType'

    return hasHiddenSort
      ? {
          ...search,
          customerType: '',
          errorType: '',
          sortBy: 'amount',
          sortDir: 'desc',
        }
      : { ...search, customerType: '', errorType: '' }
  }, [search])
  const queryString = useMemo(
    () => buildValidatedDocumentsQueryParams(validatedSearch).toString(),
    [validatedSearch],
  )

  useEffect(() => {
    if (
      !search.customerType &&
      !search.errorType &&
      search.sortBy !== 'customerType' &&
      search.sortBy !== 'errorType'
    ) {
      return
    }

    void navigate({
      search: () => validatedSearch,
      replace: true,
    })
  }, [
    navigate,
    search.customerType,
    search.errorType,
    search.sortBy,
    validatedSearch,
  ])

  const updateSearch = useCallback(
    (
      patch: Partial<ValidatedRouteSearch>,
      options: { resetPage?: boolean } = { resetPage: true },
    ) => {
      void preserveScrollDuringNavigation(() =>
        navigate({
          search: (previous) => {
            const nextSearch = parseValidatedSearch({
              ...previous,
              ...patch,
              customerType: '',
              errorType: '',
              page:
                options.resetPage === false
                  ? (patch.page ?? previous.page)
                  : 1,
            })

            return nextSearch.sortBy === 'customerType' ||
              nextSearch.sortBy === 'errorType'
              ? { ...nextSearch, sortBy: 'amount', sortDir: 'desc' }
              : nextSearch
          },
          replace: true,
          resetScroll: false,
        }),
      )
    },
    [navigate],
  )

  const refreshDocuments = useCallback(async () => {
    setIsLoading(true)

    try {
      const response = await fetch(`/api/documents/validated?${queryString}`, {
        cache: 'no-store',
      })

      const payload = (await response
        .json()
        .catch(() => null)) as DocumentsResponse | null

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            `Failed to load validated documents (${response.status}).`,
        )
      }

      setDocuments(Array.isArray(payload?.documents) ? payload.documents : [])
      setPagination(payload?.pagination ?? DEFAULT_PAGINATION)
      setSummary(payload?.summary ?? DEFAULT_SUMMARY)
      setFilterOptions(payload?.filterOptions ?? DEFAULT_FILTER_OPTIONS)
      setLastRefreshedAt(new Date())
      setLoadError(null)
    } catch (error) {
      setDocuments([])
      setPagination(DEFAULT_PAGINATION)
      setSummary(DEFAULT_SUMMARY)
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load validated documents.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [queryString])

  useEffect(() => {
    void refreshDocuments()
  }, [refreshDocuments])

  return (
    <AppShell
      title="Validated Results"
      subtitle="Ready-to-export 2307 extractions"
      pageHelp={{
        label: 'Guide me through this page',
        onStartTour: () => setTourStartSignal((current) => current + 1),
      }}
      tourTargets={{
        title: VALIDATED_TOUR_TARGETS.title,
      }}
    >
      <div className="flex flex-col gap-4">
        {loadError ? (
          <Alert variant="destructive" className="rounded-lg">
            <IconAlertTriangle />
            <AlertTitle>Unable to load validated documents</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}

        <div
          className="grid gap-2 md:grid-cols-3"
          {...getProductTourTargetProps(VALIDATED_TOUR_TARGETS.summary)}
        >
          <SummaryTile
            icon={IconFileCheck}
            label="Validated"
            value={summary.totalValidated}
            description="Ready records"
          />
          <SummaryTile
            icon={IconStack2}
            label="Certificates"
            value={summary.certificateCount}
            description="2307 documents"
          />
          <SummaryTile
            icon={IconSignature}
            label="Signed PDFs"
            value={summary.signedPdfCount}
            description="Ready downloads"
          />
        </div>

        <ValidatedDocumentsPanel
          search={validatedSearch}
          onSearchChange={(patch) => updateSearch(patch)}
          onPageChange={(page) => updateSearch({ page }, { resetPage: false })}
          onPageSizeChange={(pageSize) => updateSearch({ pageSize })}
          documents={documents}
          pagination={pagination}
          filterOptions={filterOptions}
          loading={isLoading}
          canDownloadSignedPdf={canDownloadSignedPdf}
          canAccessSigning={canAccessSigning}
          onDocumentUpdated={(updatedDocument) => {
            setDocuments((currentDocuments) =>
              currentDocuments.map((document) =>
                document.id === updatedDocument.id ? updatedDocument : document,
              ),
            )
            void refreshDocuments()
          }}
          actions={
            <RefreshStatus
              isRefreshing={isLoading}
              lastUpdatedLabel={formatPageLastUpdated(lastRefreshedAt)}
              refreshLabel="Refresh validated documents"
              onRefresh={() => void refreshDocuments()}
            />
          }
          tourTargets={{
            filters: VALIDATED_TOUR_TARGETS.filters,
            pagination: VALIDATED_TOUR_TARGETS.pagination,
            table: VALIDATED_TOUR_TARGETS.table,
          }}
        />
      </div>
      <ValidatedTour startSignal={tourStartSignal} />
    </AppShell>
  )
}
