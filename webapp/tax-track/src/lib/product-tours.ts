export const PRODUCT_TOURS_STORAGE_KEY = 'taxtrack.tours.v1'
export const SIGNING_TOUR_RESTART_EVENT = 'taxtrack.signingTour.restart'

export const PRODUCT_TOUR_IDS = {
  audit: 'audit',
  batchDetail: 'batch-detail',
  batches: 'batches',
  dashboard: 'dashboard',
  issues: 'issues',
  mergePdfs: 'merge-pdfs',
  overrides: 'override-requests',
  reconciliation: 'reconciliation',
  salesReport: 'sales-report',
  settings: 'settings',
  signing: 'signing',
  upload: 'upload',
  validated: 'validated',
} as const

export const PRODUCT_TOUR_VERSIONS = {
  audit: 1,
  batchDetail: 1,
  batches: 1,
  dashboard: 1,
  issues: 1,
  mergePdfs: 1,
  overrides: 1,
  reconciliation: 1,
  salesReport: 1,
  settings: 1,
  signing: 1,
  upload: 1,
  validated: 1,
} as const

export const DASHBOARD_TOUR_TARGETS = {
  actions: 'dashboard.actions',
  collection: 'dashboard.collection',
  entityScope: 'dashboard.entityScope',
  help: 'dashboard.help',
  metrics: 'dashboard.metrics',
  navGovernance: 'dashboard.nav.governance',
  navOutputs: 'dashboard.nav.outputs',
  navOverview: 'dashboard.nav.overview',
  navUser: 'dashboard.nav.user',
  navWorkflow: 'dashboard.nav.workflow',
  recentBatches: 'dashboard.recentBatches',
  reportingPeriod: 'dashboard.reportingPeriod',
  sidebarTrigger: 'dashboard.sidebarTrigger',
  title: 'dashboard.title',
  trend: 'dashboard.trend',
  validatedDocuments: 'dashboard.validatedDocuments',
} as const

export const UPLOAD_TOUR_TARGETS = {
  activeBatch: 'upload.activeBatch',
  batchActions: 'upload.batchActions',
  currentStatus: 'upload.currentStatus',
  entity: 'upload.entity',
  recentBatches: 'upload.recentBatches',
  selectFiles: 'upload.selectFiles',
  statusActions: 'upload.statusActions',
  statusSheet: 'upload.statusSheet',
  statusSheetIssues: 'upload.statusSheetIssues',
  statusSheetRules: 'upload.statusSheetRules',
  statusSheetSummary: 'upload.statusSheetSummary',
  statusSheetTabs: 'upload.statusSheetTabs',
  statusTable: 'upload.statusTable',
} as const

export const BATCHES_TOUR_TARGETS = {
  filters: 'batches.filters',
  pagination: 'batches.pagination',
  repositoryTabs: 'batches.repositoryTabs',
  summary: 'batches.summary',
  table: 'batches.table',
  title: 'batches.title',
} as const

export const BATCH_DETAIL_TOUR_TARGETS = {
  actions: 'batchDetail.actions',
  attention: 'batchDetail.attention',
  backAction: 'batchDetail.backAction',
  details: 'batchDetail.details',
  filesFilters: 'batchDetail.filesFilters',
  filesPagination: 'batchDetail.filesPagination',
  filesTable: 'batchDetail.filesTable',
  outcomeSummary: 'batchDetail.outcomeSummary',
  tabs: 'batchDetail.tabs',
  title: 'batchDetail.title',
} as const

export const ISSUES_TOUR_TARGETS = {
  exportAction: 'issues.exportAction',
  filters: 'issues.filters',
  pagination: 'issues.pagination',
  statusTabs: 'issues.statusTabs',
  summary: 'issues.summary',
  table: 'issues.table',
  title: 'issues.title',
} as const

export const VALIDATED_TOUR_TARGETS = {
  filters: 'validated.filters',
  pagination: 'validated.pagination',
  summary: 'validated.summary',
  table: 'validated.table',
  title: 'validated.title',
} as const

export const RECONCILIATION_TOUR_TARGETS = {
  resultsExport: 'reconciliation.resultsExport',
  resultsFilters: 'reconciliation.resultsFilters',
  resultsPagination: 'reconciliation.resultsPagination',
  resultsTable: 'reconciliation.resultsTable',
  salesReports: 'reconciliation.salesReports',
  salesReportsTable: 'reconciliation.salesReportsTable',
  summary: 'reconciliation.summary',
  title: 'reconciliation.title',
} as const

export const SALES_REPORT_TOUR_TARGETS = {
  actions: 'salesReport.actions',
  backAction: 'salesReport.backAction',
  batchSelection: 'salesReport.batchSelection',
  identity: 'salesReport.identity',
  parsedRowsFilters: 'salesReport.parsedRowsFilters',
  parsedRowsPagination: 'salesReport.parsedRowsPagination',
  parsedRowsTable: 'salesReport.parsedRowsTable',
  resultsFilters: 'salesReport.resultsFilters',
  resultsPagination: 'salesReport.resultsPagination',
  resultsTable: 'salesReport.resultsTable',
  runStatus: 'salesReport.runStatus',
  summary: 'salesReport.summary',
  title: 'salesReport.title',
} as const

export const SIGNING_TOUR_TARGETS = {
  backAction: 'signing.backAction',
  certificateList: 'signing.certificateList',
  placement: 'signing.placement',
  preview: 'signing.preview',
  previewControls: 'signing.previewControls',
  previewTabs: 'signing.previewTabs',
  profile: 'signing.profile',
  status: 'signing.status',
  summary: 'signing.summary',
  title: 'signing.title',
  toolbar: 'signing.toolbar',
} as const

export const MERGE_PDFS_TOUR_TARGETS = {
  controls: 'mergePdfs.controls',
  preview: 'mergePdfs.preview',
  recentJobs: 'mergePdfs.recentJobs',
  submitActions: 'mergePdfs.submitActions',
  summary: 'mergePdfs.summary',
  title: 'mergePdfs.title',
  workflow: 'mergePdfs.workflow',
} as const

export const OVERRIDES_TOUR_TARGETS = {
  pagination: 'overrides.pagination',
  search: 'overrides.search',
  statusTabs: 'overrides.statusTabs',
  summary: 'overrides.summary',
  table: 'overrides.table',
  title: 'overrides.title',
} as const

export const AUDIT_TOUR_TARGETS = {
  exportAction: 'audit.exportAction',
  filters: 'audit.filters',
  pagination: 'audit.pagination',
  summary: 'audit.summary',
  table: 'audit.table',
  title: 'audit.title',
} as const

export const SETTINGS_TOUR_TARGETS = {
  createUserAction: 'settings.createUserAction',
  filters: 'settings.filters',
  roleMatrix: 'settings.roleMatrix',
  summary: 'settings.summary',
  title: 'settings.title',
  usersPagination: 'settings.usersPagination',
  usersTable: 'settings.usersTable',
} as const

export type ProductTourId =
  (typeof PRODUCT_TOUR_IDS)[keyof typeof PRODUCT_TOUR_IDS]

export type ProductTourStorageState = {
  completedTours: Partial<
    Record<
      string,
      {
        completedAt: string
        version: number
      }
    >
  >
}

const emptyProductTourState = (): ProductTourStorageState => ({
  completedTours: {},
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseProductTourState = (value: unknown): ProductTourStorageState => {
  if (!isRecord(value) || !isRecord(value.completedTours)) {
    return emptyProductTourState()
  }

  const completedTours: ProductTourStorageState['completedTours'] = {}

  for (const [tourId, entry] of Object.entries(value.completedTours)) {
    if (!isRecord(entry) || typeof entry.version !== 'number') {
      continue
    }

    completedTours[tourId] = {
      completedAt:
        typeof entry.completedAt === 'string' ? entry.completedAt : '',
      version: entry.version,
    }
  }

  return { completedTours }
}

const getBrowserProductTourStorage = () => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const readProductTourState = (
  storage: Storage | null = getBrowserProductTourStorage(),
): ProductTourStorageState => {
  if (!storage) {
    return emptyProductTourState()
  }

  try {
    const rawState = storage.getItem(PRODUCT_TOURS_STORAGE_KEY)
    return rawState
      ? parseProductTourState(JSON.parse(rawState))
      : emptyProductTourState()
  } catch {
    return emptyProductTourState()
  }
}

export const hasCompletedProductTour = ({
  storage = getBrowserProductTourStorage(),
  tourId,
  version,
}: {
  storage?: Storage | null
  tourId: ProductTourId | string
  version: number
}) => readProductTourState(storage).completedTours[tourId]?.version === version

export const markProductTourCompleted = ({
  completedAt = new Date().toISOString(),
  storage = getBrowserProductTourStorage(),
  tourId,
  version,
}: {
  completedAt?: string
  storage?: Storage | null
  tourId: ProductTourId | string
  version: number
}) => {
  if (!storage) {
    return
  }

  const nextState = readProductTourState(storage)
  nextState.completedTours[tourId] = { completedAt, version }

  try {
    storage.setItem(PRODUCT_TOURS_STORAGE_KEY, JSON.stringify(nextState))
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
}

export const resetProductTour = ({
  storage = getBrowserProductTourStorage(),
  tourId,
}: {
  storage?: Storage | null
  tourId: ProductTourId | string
}) => {
  if (!storage) {
    return
  }

  const nextState = readProductTourState(storage)
  delete nextState.completedTours[tourId]

  try {
    storage.setItem(PRODUCT_TOURS_STORAGE_KEY, JSON.stringify(nextState))
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
}

export const getProductTourTargetProps = (targetId: string) => ({
  'data-tour-id': targetId,
})

export const getProductTourTargetSelector = (targetId: string) =>
  `[data-tour-id="${targetId.replace(/"/g, '\\"')}"]`
