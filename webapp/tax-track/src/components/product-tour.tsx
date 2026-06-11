import { IconChevronLeft, IconChevronRight, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EVENTS, STATUS, useJoyride } from 'react-joyride'
import type { EventData, Step, TooltipRenderProps } from 'react-joyride'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'
import { authClient } from '@/lib/auth-client'
import { canAccessPath, parseSessionContext } from '@/lib/access-control'
import {
  AUDIT_TOUR_TARGETS,
  BATCHES_TOUR_TARGETS,
  BATCH_DETAIL_TOUR_TARGETS,
  DASHBOARD_TOUR_TARGETS,
  ISSUES_TOUR_TARGETS,
  MERGE_PDFS_TOUR_TARGETS,
  OVERRIDES_TOUR_TARGETS,
  PRODUCT_TOUR_IDS,
  PRODUCT_TOUR_VERSIONS,
  RECONCILIATION_TOUR_TARGETS,
  SALES_REPORT_TOUR_TARGETS,
  SETTINGS_TOUR_TARGETS,
  SIGNING_TOUR_TARGETS,
  UPLOAD_TOUR_TARGETS,
  VALIDATED_TOUR_TARGETS,
  getProductTourTargetSelector,
  hasCompletedProductTour,
  markProductTourCompleted,
  resetProductTour,
} from '@/lib/product-tours'

type ProductTourProps = {
  autoStart?: boolean
  onTourEnd?: () => void
  startSignal?: number
  steps: Array<Step>
  tourId: string
  version: number
}

type UploadStatusSheetTourTab = 'summary' | 'issues' | 'rules'

type UploadStatusSheetTourChange = {
  open: boolean
  tab?: UploadStatusSheetTourTab
}

type BatchDetailTourTab = 'overview' | 'attention' | 'files'

type BatchDetailTabBeforeStep = (params: {
  tab: BatchDetailTourTab
  targetId: string
}) => () => Promise<void>

const PRODUCT_TOUR_OPTIONS = {
  arrowColor: 'var(--popover)',
  backgroundColor: 'var(--popover)',
  buttons: ['back', 'close', 'primary', 'skip'] as const,
  closeButtonAction: 'skip' as const,
  dismissKeyAction: 'close' as const,
  offset: 12,
  overlayClickAction: false,
  overlayColor: 'oklch(0 0 0 / 55%)',
  primaryColor: 'var(--primary)',
  scrollDuration: 250,
  scrollOffset: 76,
  showProgress: true,
  skipBeacon: true,
  spotlightPadding: 8,
  spotlightRadius: 8,
  targetWaitTimeout: 1800,
  textColor: 'var(--popover-foreground)',
  width: 'min(23rem, calc(100vw - 2rem))',
  zIndex: 80,
}

const PRODUCT_TOUR_AUTOSTART_DELAY_MS = 300
const PRODUCT_TOUR_TARGET_POLL_MS = 100
const PRODUCT_TOUR_TARGET_WAIT_MS = 6_000

const waitForProductTourTarget = (targetId: string) =>
  new Promise<void>((resolve) => {
    const selector = getProductTourTargetSelector(targetId)
    const startedAt = Date.now()

    const wait = () => {
      if (document.querySelector(selector)) {
        resolve()
        return
      }

      if (Date.now() - startedAt >= PRODUCT_TOUR_TARGET_WAIT_MS) {
        resolve()
        return
      }

      window.setTimeout(wait, PRODUCT_TOUR_TARGET_POLL_MS)
    }

    wait()
  })

const openUploadStatusSheetBeforeStep =
  (
    tab: UploadStatusSheetTourTab,
    targetId: string,
    onStatusSheetTourChange?: (change: UploadStatusSheetTourChange) => void,
  ) =>
  async () => {
    onStatusSheetTourChange?.({ open: true, tab })
    await waitForProductTourTarget(targetId)
  }

const closeUploadStatusSheetBeforeStep =
  (
    targetId: string,
    onStatusSheetTourChange?: (change: UploadStatusSheetTourChange) => void,
  ) =>
  async () => {
    onStatusSheetTourChange?.({ open: false })
    await waitForProductTourTarget(targetId)
  }

type DashboardSidebarBeforeStep = (targetId: string) => () => Promise<void>

const dashboardTarget = (targetId: string) =>
  getProductTourTargetSelector(targetId)

const createTargetStep = ({
  targetId,
  ...step
}: Omit<Step, 'id' | 'target'> & { targetId: string }): Step => ({
  id: targetId,
  target: getProductTourTargetSelector(targetId),
  ...step,
})

const buildDashboardTourSteps = ({
  includeGovernance,
  openSidebarBeforeStep,
}: {
  includeGovernance: boolean
  openSidebarBeforeStep: DashboardSidebarBeforeStep
}): Array<Step> => {
  const navSteps: Array<Step> = [
    {
      id: DASHBOARD_TOUR_TARGETS.navOverview,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.navOverview),
      title: 'Overview navigation',
      content:
        'Dashboard returns you to operational health: processing volume, collections, quality, timing, and the latest work queues.',
      before: openSidebarBeforeStep(DASHBOARD_TOUR_TARGETS.navOverview),
      placement: 'right-start',
    },
    {
      id: DASHBOARD_TOUR_TARGETS.navIntake,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.navIntake),
      title: 'Step 1: Intake',
      content:
        'Start in Intake to upload BIR 2307 PDFs and monitor the batches created from those files.',
      before: openSidebarBeforeStep(DASHBOARD_TOUR_TARGETS.navIntake),
      placement: 'right-start',
    },
    {
      id: DASHBOARD_TOUR_TARGETS.navReview,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.navReview),
      title: 'Step 2: Review',
      content:
        'Use Review to resolve issues, inspect validated results, and reconcile certificates against sales records.',
      before: openSidebarBeforeStep(DASHBOARD_TOUR_TARGETS.navReview),
      placement: 'right-start',
    },
    {
      id: DASHBOARD_TOUR_TARGETS.navMerge,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.navMerge),
      title: 'Step 3: Merge',
      content:
        'Use Merge to combine certificate PDFs into packages for delivery or filing.',
      before: openSidebarBeforeStep(DASHBOARD_TOUR_TARGETS.navMerge),
      placement: 'right-start',
    },
  ]

  if (includeGovernance) {
    navSteps.push({
      id: DASHBOARD_TOUR_TARGETS.navGovernance,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.navGovernance),
      title: 'Admin navigation',
      content:
        'Admin pages handle override requests, audit logs, and settings for users with access.',
      before: openSidebarBeforeStep(DASHBOARD_TOUR_TARGETS.navGovernance),
      placement: 'right-start',
    })
  }

  navSteps.push({
    id: DASHBOARD_TOUR_TARGETS.navUser,
    target: dashboardTarget(DASHBOARD_TOUR_TARGETS.navUser),
    title: 'User menu',
    content:
      'Use the profile menu to open account settings or sign out when you are finished working in TaxTrack.',
    before: openSidebarBeforeStep(DASHBOARD_TOUR_TARGETS.navUser),
    placement: 'right-end',
  })

  return [
    {
      id: DASHBOARD_TOUR_TARGETS.title,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.title),
      title: 'Start with the dashboard',
      content:
        'This page summarizes BIR 2307 processing, collection status, and the current work that needs attention.',
      placement: 'bottom-start',
    },
    {
      id: DASHBOARD_TOUR_TARGETS.sidebarTrigger,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.sidebarTrigger),
      title: 'Show or hide navigation',
      content:
        'Use this header button to open the navigation sidebar when you need to move between TaxTrack work areas.',
      placement: 'bottom-start',
    },
    {
      id: DASHBOARD_TOUR_TARGETS.entityScope,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.entityScope),
      title: 'Scope the dashboard by entity',
      content:
        'Use the entity selector to view all entities or narrow the dashboard to one taxpayer.',
      placement: 'bottom-end',
    },
    {
      id: DASHBOARD_TOUR_TARGETS.actions,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.actions),
      title: 'Refresh live dashboard data',
      content:
        'Refresh reloads the dashboard summary. The timestamp shows when the current analytics were generated.',
      placement: 'bottom-end',
    },
    {
      id: DASHBOARD_TOUR_TARGETS.help,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.help),
      title: 'Find page help',
      content:
        'Help lets you restart this tour from the dashboard header or contact support when something needs follow-up.',
      placement: 'bottom-end',
    },
    ...navSteps,
    {
      id: DASHBOARD_TOUR_TARGETS.reportingPeriod,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.reportingPeriod),
      title: 'Choose the reporting period',
      content:
        'Switch between monthly, quarterly, and yearly views, then pick the exact period to summarize.',
      placement: 'bottom-start',
    },
    {
      id: DASHBOARD_TOUR_TARGETS.metrics,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.metrics),
      title: 'Read the metric band',
      content:
        'The metric band groups volume, collection, quality, and timing signals so you can scan operational health quickly.',
      placement: 'bottom-start',
    },
    {
      id: DASHBOARD_TOUR_TARGETS.trend,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.trend),
      title: 'Compare trend and collection status',
      content:
        'The trend chart shows uploaded, processed, and collected certificates. The collection card beside it separates collected and still-uncollected amounts.',
      placement: 'top-start',
    },
    {
      id: DASHBOARD_TOUR_TARGETS.recentBatches,
      target: dashboardTarget(DASHBOARD_TOUR_TARGETS.recentBatches),
      title: 'Review current work tables',
      content:
        'Recent batches shows active processing work, while validated documents highlights certificates ready for review or downstream workflows.',
      placement: 'top-start',
    },
  ]
}

const buildBatchesTourSteps = (): Array<Step> => [
  createTargetStep({
    targetId: BATCHES_TOUR_TARGETS.title,
    title: 'Batches',
    content:
      'Use this page to monitor upload batches across the organization and jump into the batch that needs review.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: BATCHES_TOUR_TARGETS.summary,
    title: 'Batch health at a glance',
    content:
      'These counts separate total, active, needs-review, and completed batches so the current workload is easy to scan.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: BATCHES_TOUR_TARGETS.repositoryTabs,
    title: 'Switch repositories',
    content:
      'Use Active for current intake work and Recently Deleted when you need to inspect or restore removed batches.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: BATCHES_TOUR_TARGETS.filters,
    title: 'Find the right batch',
    content:
      'Filter by search text, processing status, signing status, and attention state before opening a batch.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: BATCHES_TOUR_TARGETS.table,
    title: 'Open batch details',
    content:
      'The table shows ownership, status, signing progress, and timestamps. Select a row to work with its files.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: BATCHES_TOUR_TARGETS.pagination,
    title: 'Move through batch history',
    content:
      'Adjust rows per page or move between pages while keeping the current filters applied.',
    placement: 'top-start',
  }),
]

const buildBatchDetailTourSteps = ({
  openTabBeforeStep,
}: {
  openTabBeforeStep: BatchDetailTabBeforeStep
}): Array<Step> => [
  createTargetStep({
    targetId: BATCH_DETAIL_TOUR_TARGETS.title,
    title: 'Batch detail',
    content:
      'Use this detail view to review one upload batch, its file outcomes, and the next workflow action available for the batch state.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: BATCH_DETAIL_TOUR_TARGETS.backAction,
    title: 'Return to the list',
    content:
      'Back returns to the page you came from, either the batch repository or the upload workspace.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: BATCH_DETAIL_TOUR_TARGETS.tabs,
    title: 'Switch batch views',
    content:
      'Overview summarizes the batch, Needs attention isolates duplicates or failures, and Files lists every persisted upload.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: BATCH_DETAIL_TOUR_TARGETS.actions,
    title: 'Use batch actions',
    content:
      'This action group changes with batch state and access. You may see close, rename, sign, export, re-open, or delete options.',
    before: openTabBeforeStep({
      tab: 'overview',
      targetId: BATCH_DETAIL_TOUR_TARGETS.actions,
    }),
    placement: 'bottom-end',
  }),
  createTargetStep({
    targetId: BATCH_DETAIL_TOUR_TARGETS.details,
    title: 'Check batch details',
    content:
      'This area shows identifiers, timing, file count, and workflow guidance for deciding what should happen next.',
    before: openTabBeforeStep({
      tab: 'overview',
      targetId: BATCH_DETAIL_TOUR_TARGETS.details,
    }),
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: BATCH_DETAIL_TOUR_TARGETS.outcomeSummary,
    title: 'Scan outcomes',
    content:
      'The summary separates successful, processing, pending, and review-needed files so the batch health is easy to read.',
    before: openTabBeforeStep({
      tab: 'overview',
      targetId: BATCH_DETAIL_TOUR_TARGETS.outcomeSummary,
    }),
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: BATCH_DETAIL_TOUR_TARGETS.attention,
    title: 'Review items needing attention',
    content:
      'Needs attention lists duplicate or validation-error files. Use the row action when data is available to open the relevant detail.',
    before: openTabBeforeStep({
      tab: 'attention',
      targetId: BATCH_DETAIL_TOUR_TARGETS.attention,
    }),
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: BATCH_DETAIL_TOUR_TARGETS.filesFilters,
    title: 'Filter batch files',
    content:
      'Search by file or error text, filter by status, and adjust row count while staying on this batch.',
    before: openTabBeforeStep({
      tab: 'files',
      targetId: BATCH_DETAIL_TOUR_TARGETS.filesFilters,
    }),
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: BATCH_DETAIL_TOUR_TARGETS.filesTable,
    title: 'Open file details',
    content:
      'The files table shows processing status and timestamps. Select a row to open the related document detail when available.',
    before: openTabBeforeStep({
      tab: 'files',
      targetId: BATCH_DETAIL_TOUR_TARGETS.filesTable,
    }),
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: BATCH_DETAIL_TOUR_TARGETS.filesPagination,
    title: 'Move through files',
    content:
      'Use pagination to browse larger batches while preserving the current filters and tab state.',
    before: openTabBeforeStep({
      tab: 'files',
      targetId: BATCH_DETAIL_TOUR_TARGETS.filesPagination,
    }),
    placement: 'top-start',
  }),
]

const buildIssuesTourSteps = (): Array<Step> => [
  createTargetStep({
    targetId: ISSUES_TOUR_TARGETS.title,
    title: 'Issues Queue',
    content:
      'Use this page to work through duplicate uploads and validation failures before they become validated documents.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: ISSUES_TOUR_TARGETS.summary,
    title: 'Understand issue volume',
    content:
      'The summary separates total flagged records, validation errors, and duplicates.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: ISSUES_TOUR_TARGETS.exportAction,
    title: 'Export the queue',
    content:
      'Export downloads the currently filtered issues queue when rows are available.',
    placement: 'bottom-end',
  }),
  createTargetStep({
    targetId: ISSUES_TOUR_TARGETS.filters,
    title: 'Narrow the queue',
    content:
      'Search and filter by severity, owner, and reporting period to focus review work.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: ISSUES_TOUR_TARGETS.statusTabs,
    title: 'Separate errors and duplicates',
    content:
      'Use the tabs to see all issues together or isolate validation errors and duplicate uploads.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: ISSUES_TOUR_TARGETS.table,
    title: 'Review flagged documents',
    content:
      'Select a row to open the detail drawer with processing trail, issue reason, and next-step context.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: ISSUES_TOUR_TARGETS.pagination,
    title: 'Page through issues',
    content:
      'Use rows per page and navigation controls to move through the filtered queue.',
    placement: 'top-start',
  }),
]

const buildValidatedTourSteps = (): Array<Step> => [
  createTargetStep({
    targetId: VALIDATED_TOUR_TARGETS.title,
    title: 'Validated Results',
    content:
      'Use this page to review BIR 2307 records that passed validation and are ready for signing or export workflows.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: VALIDATED_TOUR_TARGETS.summary,
    title: 'Validated output summary',
    content:
      'These counts show ready records, certificate volume, and signed PDFs available for downstream work.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: VALIDATED_TOUR_TARGETS.filters,
    title: 'Filter validated records',
    content:
      'Search by file, customer, or ATC, then narrow by year, month, quarter, and ATC.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: VALIDATED_TOUR_TARGETS.table,
    title: 'Inspect documents and actions',
    content:
      'The table supports sorting, row details, signing links, and signed-PDF downloads when your access allows them.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: VALIDATED_TOUR_TARGETS.pagination,
    title: 'Browse validated records',
    content:
      'Use pagination to move through the filtered result set without losing the current filters.',
    placement: 'top-start',
  }),
]

const buildReconciliationTourSteps = (): Array<Step> => [
  createTargetStep({
    targetId: RECONCILIATION_TOUR_TARGETS.title,
    title: 'Reconciliation',
    content:
      'Use this page to upload sales reports, compare them with closed certificate batches, and review active reconciliation rows.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: RECONCILIATION_TOUR_TARGETS.summary,
    title: 'Read active result health',
    content:
      'The summary highlights active records, matched and unmatched counts, and the total variance in the current view.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: RECONCILIATION_TOUR_TARGETS.salesReports,
    title: 'Manage sales reports',
    content:
      'Upload a report for the selected entity, then open a report row to choose batches and run reconciliation.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: RECONCILIATION_TOUR_TARGETS.salesReportsTable,
    title: 'Track report readiness',
    content:
      'This table shows report status, row counts, latest runs, and when each report was updated.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: RECONCILIATION_TOUR_TARGETS.resultsExport,
    title: 'Export reconciliation workbooks',
    content:
      'Choose monthly, quarterly, or annual output and export the selected period when your access allows spreadsheet exports.',
    placement: 'bottom-end',
  }),
  createTargetStep({
    targetId: RECONCILIATION_TOUR_TARGETS.resultsFilters,
    title: 'Filter active rows',
    content:
      'Search customer, TIN, invoice, or transaction line, then filter the table to the records that need review.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: RECONCILIATION_TOUR_TARGETS.resultsTable,
    title: 'Work reconciliation rows',
    content:
      'Select a row to open details, review match status, and send outreach when a customer group needs follow-up.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: RECONCILIATION_TOUR_TARGETS.resultsPagination,
    title: 'Move through active rows',
    content:
      'Pagination appears with active rows so you can navigate larger result sets while keeping filters applied.',
    placement: 'top-start',
  }),
]

const buildSalesReportTourSteps = (): Array<Step> => [
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.title,
    title: 'Sales report detail',
    content:
      'Use this page to review parsed sales rows, select closed batches, and run reconciliation for this report.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.backAction,
    title: 'Return to reconciliation',
    content:
      'Back returns to the reconciliation page with its default report and result filters.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.identity,
    title: 'Check report identity',
    content:
      'This card shows report status, active version, entity, report name, and the original workbook file.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.actions,
    title: 'Manage the report file',
    content:
      'Use these actions to update the workbook, download the original, refresh data, rename the report, or delete it when appropriate.',
    placement: 'bottom-end',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.summary,
    title: 'Read report metrics',
    content:
      'These metrics summarize parsed rows, current matched and unmatched results, variance, and the last update.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.batchSelection,
    title: 'Select batches to reconcile',
    content:
      'Choose eligible closed batches for the same entity, then run reconciliation when the selected set is ready.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.runStatus,
    title: 'Review latest run status',
    content:
      'Run status summarizes the latest explicit reconciliation run and the active result totals it produced.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.parsedRowsFilters,
    title: 'Filter parsed sales rows',
    content:
      'Search normalized sales rows by customer, TIN, invoice, row number, or billing month before inspecting the table.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.parsedRowsTable,
    title: 'Inspect parsed rows',
    content:
      'This table shows the active workbook rows that feed reconciliation, including invoice, billing, taxable sales, and prepaid CWT.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.parsedRowsPagination,
    title: 'Browse parsed rows',
    content:
      'Use pagination to move through parsed workbook rows while keeping the current search.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.resultsFilters,
    title: 'Filter reconciliation results',
    content:
      'Search and filter active reconciliation rows to focus on matched records, differences, or rows needing follow-up.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.resultsTable,
    title: 'Work active results',
    content:
      'The active results table shows current non-archived reconciliation output. Row email actions appear when follow-up is available.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: SALES_REPORT_TOUR_TARGETS.resultsPagination,
    title: 'Move through results',
    content:
      'Use pagination to browse larger reconciliation result sets without losing the current filters.',
    placement: 'top-start',
  }),
]

const buildSigningTourSteps = (): Array<Step> => [
  createTargetStep({
    targetId: SIGNING_TOUR_TARGETS.title,
    title: 'Signing workspace',
    content:
      'Use this workspace to place signer details, review certificate pages, and generate signed PDFs for the closed batch.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SIGNING_TOUR_TARGETS.backAction,
    title: 'Return to batch detail',
    content:
      'Back returns to the batch detail page without changing placements or signing state.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SIGNING_TOUR_TARGETS.summary,
    title: 'Read batch signing status',
    content:
      'The summary shows the batch name, certificate count, latest signed metadata, and how many pages still need signatures.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SIGNING_TOUR_TARGETS.toolbar,
    title: 'Use signing actions',
    content:
      'The toolbar changes with the batch state. Sign, download, re-sign, or open the profile editor when those actions are available.',
    placement: 'bottom-end',
  }),
  createTargetStep({
    targetId: SIGNING_TOUR_TARGETS.certificateList,
    title: 'Choose certificate pages',
    content:
      'This virtualized list shows only visible rows for performance. Select a page to review its PDF and placement state.',
    placement: 'right-start',
  }),
  createTargetStep({
    targetId: SIGNING_TOUR_TARGETS.previewTabs,
    title: 'Switch PDF views',
    content:
      'Use Source PDF for placement work and Signed PDF to inspect generated output when a signed file exists.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SIGNING_TOUR_TARGETS.previewControls,
    title: 'Navigate the preview',
    content:
      'Move between pages, adjust zoom, choose a fit preset, or open the preview fullscreen.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SIGNING_TOUR_TARGETS.preview,
    title: 'Place text and signature',
    content:
      'Click the source PDF preview to position the Name / Designation / TIN block first, then the e-signature.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: SIGNING_TOUR_TARGETS.status,
    title: 'Check readiness',
    content:
      'This card tells you whether the current batch is ready to sign, already signed, or still needs placement work.',
    placement: 'left-start',
  }),
  createTargetStep({
    targetId: SIGNING_TOUR_TARGETS.placement,
    title: 'Fine-tune placement',
    content:
      'Use the placement panel to switch between text and signature placement, resize the signature, and copy placement to other pages.',
    placement: 'left-start',
  }),
  createTargetStep({
    targetId: SIGNING_TOUR_TARGETS.profile,
    title: 'Review signature profile',
    content:
      'The profile card shows the saved signer details and image. Edit or set up the profile when signer information changes.',
    placement: 'left-start',
  }),
]

const buildMergePdfsTourSteps = (): Array<Step> => [
  createTargetStep({
    targetId: MERGE_PDFS_TOUR_TARGETS.title,
    title: 'Merge PDFs',
    content:
      'Use this page to combine signed 2307 PDFs into EAFS-ready output batches.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: MERGE_PDFS_TOUR_TARGETS.summary,
    title: 'Monitor merge jobs',
    content:
      'These counts show total jobs, active processing, and outputs that are ready to download.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: MERGE_PDFS_TOUR_TARGETS.workflow,
    title: 'Follow the merge workflow',
    content:
      'The workflow moves from selecting scope, to previewing the split, to submitting the merge job.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: MERGE_PDFS_TOUR_TARGETS.controls,
    title: 'Choose entity and period',
    content:
      'Select the payee entity and reporting period that should be packaged into signed PDF outputs.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: MERGE_PDFS_TOUR_TARGETS.preview,
    title: 'Preview output batches',
    content:
      'Preview shows how signed PDFs will be split, including output count, size, and late certificates.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: MERGE_PDFS_TOUR_TARGETS.submitActions,
    title: 'Preview, then submit',
    content:
      'Preview the split first, then submit the merge job once the output package looks right.',
    placement: 'top-end',
  }),
  createTargetStep({
    targetId: MERGE_PDFS_TOUR_TARGETS.recentJobs,
    title: 'Download recent outputs',
    content:
      'Recent jobs show processing status and download buttons for completed output parts.',
    placement: 'top-start',
  }),
]

const buildOverridesTourSteps = (): Array<Step> => [
  createTargetStep({
    targetId: OVERRIDES_TOUR_TARGETS.title,
    title: 'Overrides',
    content:
      'Use this page to review exception requests for failed BIR 2307 certificates.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: OVERRIDES_TOUR_TARGETS.summary,
    title: 'Track decision status',
    content:
      'The summary separates pending, approved, and rejected override requests.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: OVERRIDES_TOUR_TARGETS.search,
    title: 'Search requests',
    content:
      'Find requests by file, entity, payor, TIN, or requester before making a decision.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: OVERRIDES_TOUR_TARGETS.statusTabs,
    title: 'Switch request status',
    content:
      'Use the status tabs to focus on pending decisions or review approved and rejected requests.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: OVERRIDES_TOUR_TARGETS.table,
    title: 'Open the decision sheet',
    content:
      'Select a request row to open the decision sheet with request details and approve or reject actions.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: OVERRIDES_TOUR_TARGETS.pagination,
    title: 'Page through requests',
    content:
      'Use rows per page and pagination controls to move through larger request queues.',
    placement: 'top-start',
  }),
]

const buildAuditTourSteps = (): Array<Step> => [
  createTargetStep({
    targetId: AUDIT_TOUR_TARGETS.title,
    title: 'Audit Trail',
    content:
      'Use this page to inspect immutable user and system activity across TaxTrack.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: AUDIT_TOUR_TARGETS.summary,
    title: 'Audit volume summary',
    content:
      'These counts show matching events, unique actors, and automated system activity.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: AUDIT_TOUR_TARGETS.exportAction,
    title: 'Export audit records',
    content:
      'Export the current filtered audit view as CSV or Excel when you need an external evidence file.',
    placement: 'bottom-end',
  }),
  createTargetStep({
    targetId: AUDIT_TOUR_TARGETS.filters,
    title: 'Filter the trail',
    content:
      'Search and filter by action, actor, target, and date range to isolate the event history you need.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: AUDIT_TOUR_TARGETS.table,
    title: 'Read immutable events',
    content:
      'The table records timestamp, actor, action, target, and metadata for each matching event.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: AUDIT_TOUR_TARGETS.pagination,
    title: 'Browse audit history',
    content:
      'Use page size and navigation controls to move through the filtered audit log.',
    placement: 'top-start',
  }),
]

const buildSettingsTourSteps = (): Array<Step> => [
  createTargetStep({
    targetId: SETTINGS_TOUR_TARGETS.title,
    title: 'Settings',
    content:
      'Use this page to manage users, access levels, and administrative controls.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SETTINGS_TOUR_TARGETS.createUserAction,
    title: 'Create users',
    content:
      'Create User opens the setup sheet for adding a new account and assigning access.',
    placement: 'bottom-end',
  }),
  createTargetStep({
    targetId: SETTINGS_TOUR_TARGETS.summary,
    title: 'Review access totals',
    content:
      'The summary shows total users, active accounts, administrators, and deactivated accounts.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SETTINGS_TOUR_TARGETS.filters,
    title: 'Filter and export users',
    content:
      'Search by user and filter by role, team, or status. Export downloads the current filtered user list.',
    placement: 'bottom-start',
  }),
  createTargetStep({
    targetId: SETTINGS_TOUR_TARGETS.usersTable,
    title: 'Manage user access',
    content:
      'Select a user row to open the access sheet, update role or team, reset passwords, and manage account status.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: SETTINGS_TOUR_TARGETS.usersPagination,
    title: 'Browse users',
    content:
      'Use pagination to move through filtered users while keeping the current filter set.',
    placement: 'top-start',
  }),
  createTargetStep({
    targetId: SETTINGS_TOUR_TARGETS.roleMatrix,
    title: 'Check role permissions',
    content:
      'The role access matrix summarizes what each role can do across settings, upload, reports, and audit areas.',
    placement: 'top-start',
  }),
]

const buildUploadTourSteps = ({
  onStatusSheetTourChange,
}: {
  onStatusSheetTourChange?: (change: UploadStatusSheetTourChange) => void
} = {}): Array<Step> => [
  {
    id: UPLOAD_TOUR_TARGETS.entity,
    target: getProductTourTargetSelector(UPLOAD_TOUR_TARGETS.entity),
    title: 'Choose the entity first',
    content:
      'Select the taxpayer or entity these PDFs belong to. The batch locks to that entity when uploads start.',
    placement: 'bottom-start',
  },
  {
    id: UPLOAD_TOUR_TARGETS.activeBatch,
    target: getProductTourTargetSelector(UPLOAD_TOUR_TARGETS.activeBatch),
    title: 'Work from one active batch',
    content:
      'This card shows the reusable intake batch. You can add PDFs over time, and each certificate moves through processing independently.',
    placement: 'bottom-start',
  },
  {
    id: UPLOAD_TOUR_TARGETS.selectFiles,
    target: getProductTourTargetSelector(UPLOAD_TOUR_TARGETS.selectFiles),
    title: 'Select BIR 2307 PDFs',
    content:
      'Choose one or more PDF files. Unsupported or oversized files are skipped before the batch upload begins.',
    placement: 'top',
  },
  {
    id: UPLOAD_TOUR_TARGETS.batchActions,
    target: getProductTourTargetSelector(UPLOAD_TOUR_TARGETS.batchActions),
    title: 'Upload, then close when finished',
    content:
      'After files are selected, this area becomes the upload control set. Close the batch only after all PDFs for that run are added.',
    placement: 'top-start',
  },
  {
    id: UPLOAD_TOUR_TARGETS.statusActions,
    target: getProductTourTargetSelector(UPLOAD_TOUR_TARGETS.statusActions),
    title: 'Check status and rules anytime',
    content:
      'Current status opens a live side panel. Rules explains the batch limits, entity lock, and file handling behavior.',
    placement: 'bottom-end',
  },
  {
    id: UPLOAD_TOUR_TARGETS.currentStatus,
    target: getProductTourTargetSelector(UPLOAD_TOUR_TARGETS.currentStatus),
    title: 'Open the status panel',
    content:
      'Click Current status to open the side panel. The tour continues there with live counts, issues, and rules.',
    blockTargetInteraction: false,
    placement: 'bottom-end',
  },
  {
    id: UPLOAD_TOUR_TARGETS.statusSheetSummary,
    target: getProductTourTargetSelector(
      UPLOAD_TOUR_TARGETS.statusSheetSummary,
    ),
    title: 'Read the batch summary',
    content:
      'The summary tab gives the batch name, latest activity, and queue counts so you can quickly understand where processing stands.',
    before: openUploadStatusSheetBeforeStep(
      'summary',
      UPLOAD_TOUR_TARGETS.statusSheetSummary,
      onStatusSheetTourChange,
    ),
    placement: 'left-start',
  },
  {
    id: UPLOAD_TOUR_TARGETS.statusSheetTabs,
    target: getProductTourTargetSelector(UPLOAD_TOUR_TARGETS.statusSheetTabs),
    title: 'Move between status views',
    content:
      'Use Summary, Issues, and Rules to switch between operational progress, files that need review, and intake guidance.',
    placement: 'left',
  },
  {
    id: UPLOAD_TOUR_TARGETS.statusSheetIssues,
    target: getProductTourTargetSelector(UPLOAD_TOUR_TARGETS.statusSheetIssues),
    title: 'Review files needing attention',
    content:
      'Issues collects duplicate, failed, and review-required uploads so you can jump directly to the document that needs work.',
    before: openUploadStatusSheetBeforeStep(
      'issues',
      UPLOAD_TOUR_TARGETS.statusSheetIssues,
      onStatusSheetTourChange,
    ),
    placement: 'left-start',
  },
  {
    id: UPLOAD_TOUR_TARGETS.statusSheetRules,
    target: getProductTourTargetSelector(UPLOAD_TOUR_TARGETS.statusSheetRules),
    title: 'Confirm upload rules',
    content:
      'Rules stays available in the same panel when you need to check batch limits, entity behavior, and file requirements.',
    before: openUploadStatusSheetBeforeStep(
      'rules',
      UPLOAD_TOUR_TARGETS.statusSheetRules,
      onStatusSheetTourChange,
    ),
    placement: 'left-start',
  },
  {
    id: UPLOAD_TOUR_TARGETS.statusTable,
    target: getProductTourTargetSelector(UPLOAD_TOUR_TARGETS.statusTable),
    title: 'Monitor every certificate',
    content:
      'Use the status table to filter active files, spot processing progress, and open documents that need review.',
    before: closeUploadStatusSheetBeforeStep(
      UPLOAD_TOUR_TARGETS.statusTable,
      onStatusSheetTourChange,
    ),
    placement: 'top-start',
  },
  {
    id: UPLOAD_TOUR_TARGETS.recentBatches,
    target: getProductTourTargetSelector(UPLOAD_TOUR_TARGETS.recentBatches),
    title: 'Return to recent work',
    content:
      'Recent batches gives quick access to the current batch and completed runs without leaving the upload workflow.',
    placement: 'top-start',
  },
]

type ElementTargetRef = {
  current: HTMLElement | null
}

const isElementRef = (target: Step['target']): target is ElementTargetRef =>
  typeof target === 'object' && 'current' in target

const getProductTourTargetElement = (target: Step['target']) => {
  if (typeof target === 'string') {
    return document.querySelector(target)
  }

  if (typeof target === 'function') {
    return target()
  }

  if (isElementRef(target)) {
    return target.current
  }

  return target
}

function ProductTourTooltip({
  backProps,
  closeProps,
  continuous,
  index,
  isLastStep,
  primaryProps,
  size,
  skipProps,
  step,
  tooltipProps,
}: TooltipRenderProps) {
  return (
    <div
      {...tooltipProps}
      className="w-[min(23rem,calc(100vw-2rem))] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <Badge variant="outline">
            Step {index + 1} of {size}
          </Badge>
          {step.title ? (
            <p className="text-sm font-semibold">{step.title}</p>
          ) : null}
        </div>
        <Button type="button" size="icon-xs" variant="ghost" {...closeProps}>
          <IconX />
        </Button>
      </div>

      <div className="mt-2 text-sm leading-5 text-muted-foreground">
        {step.content}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" {...skipProps}>
          {skipProps.title}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {index > 0 ? (
            <Button type="button" size="sm" variant="outline" {...backProps}>
              <IconChevronLeft data-icon="inline-start" />
              {backProps.title}
            </Button>
          ) : null}
          {continuous ? (
            <Button type="button" size="sm" {...primaryProps}>
              {isLastStep ? primaryProps.title : 'Next'}
              {!isLastStep ? <IconChevronRight data-icon="inline-end" /> : null}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ProductTourRuntime({
  autoStart = true,
  onTourEnd,
  startSignal = 0,
  steps,
  tourId,
  version,
}: ProductTourProps) {
  const autoStartedRef = useRef(false)
  const lastStartSignalRef = useRef(startSignal)
  const { controls, on, Tour } = useJoyride({
    continuous: true,
    locale: {
      last: 'Done',
      next: 'Next',
      nextWithProgress: 'Next ({current} of {total})',
      skip: 'Skip tour',
    },
    options: PRODUCT_TOUR_OPTIONS,
    steps,
    tooltipComponent: ProductTourTooltip,
  })

  useEffect(() => {
    return on(EVENTS.TOUR_END, (data: EventData) => {
      if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
        markProductTourCompleted({ tourId, version })
        onTourEnd?.()
      }
    })
  }, [on, onTourEnd, tourId, version])

  useEffect(() => {
    if (!autoStart || autoStartedRef.current || steps.length === 0) {
      return
    }

    if (hasCompletedProductTour({ tourId, version })) {
      return
    }

    const firstStep = steps[0]
    let isCancelled = false
    let targetPoll: number | undefined
    const startedAt = Date.now()

    const startWhenTargetIsReady = () => {
      if (isCancelled || autoStartedRef.current) {
        return
      }

      if (getProductTourTargetElement(firstStep.target)) {
        autoStartedRef.current = true
        controls.start()
        return
      }

      if (Date.now() - startedAt >= PRODUCT_TOUR_TARGET_WAIT_MS) {
        return
      }

      targetPoll = window.setTimeout(
        startWhenTargetIsReady,
        PRODUCT_TOUR_TARGET_POLL_MS,
      )
    }

    const timeout = window.setTimeout(
      startWhenTargetIsReady,
      PRODUCT_TOUR_AUTOSTART_DELAY_MS,
    )

    return () => {
      isCancelled = true
      window.clearTimeout(timeout)
      if (targetPoll !== undefined) {
        window.clearTimeout(targetPoll)
      }
    }
  }, [autoStart, controls, steps.length, tourId, version])

  useEffect(() => {
    if (startSignal === lastStartSignalRef.current) {
      return
    }

    lastStartSignalRef.current = startSignal
    resetProductTour({ tourId })
    controls.reset(true)
  }, [controls, startSignal, tourId])

  return Tour
}

export function ProductTour(props: ProductTourProps) {
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  return isMounted ? <ProductTourRuntime {...props} /> : null
}

export function DashboardTour({ startSignal = 0 }: { startSignal?: number }) {
  const { data: session, isPending } = authClient.useSession()
  const { isMobile, setOpen, setOpenMobile } = useSidebar()
  const role = session?.user ? parseSessionContext(session.user).role : 'viewer'
  const includeGovernance =
    canAccessPath('/override-requests', role) ||
    canAccessPath('/audit', role) ||
    canAccessPath('/settings', role)
  const openSidebarBeforeStep = useCallback(
    (targetId: string) => async () => {
      if (isMobile) {
        setOpenMobile(true)
      } else {
        setOpen(true)
      }

      await waitForProductTourTarget(targetId)
    },
    [isMobile, setOpen, setOpenMobile],
  )
  const steps = useMemo(
    () =>
      isPending
        ? []
        : buildDashboardTourSteps({
            includeGovernance,
            openSidebarBeforeStep,
          }),
    [includeGovernance, isPending, openSidebarBeforeStep],
  )

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.dashboard}
      version={PRODUCT_TOUR_VERSIONS.dashboard}
    />
  )
}

export function BatchesTour({ startSignal = 0 }: { startSignal?: number }) {
  const steps = useMemo(() => buildBatchesTourSteps(), [])

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.batches}
      version={PRODUCT_TOUR_VERSIONS.batches}
    />
  )
}

export function BatchDetailTour({
  onTabTourChange,
  startSignal = 0,
}: {
  onTabTourChange?: (tab: BatchDetailTourTab) => void
  startSignal?: number
}) {
  const openTabBeforeStep = useCallback(
    ({ tab, targetId }: { tab: BatchDetailTourTab; targetId: string }) =>
      async () => {
        onTabTourChange?.(tab)
        await waitForProductTourTarget(targetId)
      },
    [onTabTourChange],
  )
  const steps = useMemo(
    () => buildBatchDetailTourSteps({ openTabBeforeStep }),
    [openTabBeforeStep],
  )

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.batchDetail}
      version={PRODUCT_TOUR_VERSIONS.batchDetail}
    />
  )
}

export function IssuesTour({ startSignal = 0 }: { startSignal?: number }) {
  const steps = useMemo(() => buildIssuesTourSteps(), [])

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.issues}
      version={PRODUCT_TOUR_VERSIONS.issues}
    />
  )
}

export function ValidatedTour({ startSignal = 0 }: { startSignal?: number }) {
  const steps = useMemo(() => buildValidatedTourSteps(), [])

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.validated}
      version={PRODUCT_TOUR_VERSIONS.validated}
    />
  )
}

export function ReconciliationTour({
  startSignal = 0,
}: {
  startSignal?: number
}) {
  const steps = useMemo(() => buildReconciliationTourSteps(), [])

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.reconciliation}
      version={PRODUCT_TOUR_VERSIONS.reconciliation}
    />
  )
}

export function SalesReportTour({
  startSignal = 0,
}: {
  startSignal?: number
}) {
  const steps = useMemo(() => buildSalesReportTourSteps(), [])

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.salesReport}
      version={PRODUCT_TOUR_VERSIONS.salesReport}
    />
  )
}

export function SigningTour({ startSignal = 0 }: { startSignal?: number }) {
  const steps = useMemo(() => buildSigningTourSteps(), [])

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.signing}
      version={PRODUCT_TOUR_VERSIONS.signing}
    />
  )
}

export function MergePdfsTour({ startSignal = 0 }: { startSignal?: number }) {
  const steps = useMemo(() => buildMergePdfsTourSteps(), [])

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.mergePdfs}
      version={PRODUCT_TOUR_VERSIONS.mergePdfs}
    />
  )
}

export function OverridesTour({ startSignal = 0 }: { startSignal?: number }) {
  const steps = useMemo(() => buildOverridesTourSteps(), [])

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.overrides}
      version={PRODUCT_TOUR_VERSIONS.overrides}
    />
  )
}

export function AuditTour({ startSignal = 0 }: { startSignal?: number }) {
  const steps = useMemo(() => buildAuditTourSteps(), [])

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.audit}
      version={PRODUCT_TOUR_VERSIONS.audit}
    />
  )
}

export function SettingsTour({ startSignal = 0 }: { startSignal?: number }) {
  const steps = useMemo(() => buildSettingsTourSteps(), [])

  return (
    <ProductTour
      autoStart
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.settings}
      version={PRODUCT_TOUR_VERSIONS.settings}
    />
  )
}

export function UploadIntakeTour({
  onStatusSheetTourChange,
  startSignal = 0,
}: {
  onStatusSheetTourChange?: (change: UploadStatusSheetTourChange) => void
  startSignal?: number
}) {
  const steps = useMemo(
    () => buildUploadTourSteps({ onStatusSheetTourChange }),
    [onStatusSheetTourChange],
  )

  return (
    <ProductTour
      autoStart
      onTourEnd={() => onStatusSheetTourChange?.({ open: false })}
      startSignal={startSignal}
      steps={steps}
      tourId={PRODUCT_TOUR_IDS.upload}
      version={PRODUCT_TOUR_VERSIONS.upload}
    />
  )
}
