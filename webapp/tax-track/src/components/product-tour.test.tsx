/* @vitest-environment jsdom */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('ProductTour auto-start contract', () => {
  it('starts incomplete tours automatically after mount', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/product-tour.tsx'),
      'utf8',
    )

    expect(source).toContain('autoStart = true')
    expect(source).toContain('hasCompletedProductTour({')
    expect(source).toContain('const timeout = window.setTimeout')
    expect(source).toContain('controls.start()')
  })

  it('opens the upload status sheet before touring sheet content', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/product-tour.tsx'),
      'utf8',
    )

    expect(source).toContain('openUploadStatusSheetBeforeStep(')
    expect(source).toContain('UPLOAD_TOUR_TARGETS.currentStatus')
    expect(source).toContain('UPLOAD_TOUR_TARGETS.statusSheetSummary')
    expect(source).toContain('UPLOAD_TOUR_TARGETS.statusSheetIssues')
    expect(source).toContain('UPLOAD_TOUR_TARGETS.statusSheetRules')
    expect(source).toContain('closeUploadStatusSheetBeforeStep(')
  })

  it('builds a dashboard tour with sidebar-aware navigation steps', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/product-tour.tsx'),
      'utf8',
    )

    expect(source).toContain('export function DashboardTour')
    expect(source).toContain('buildDashboardTourSteps')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.sidebarTrigger')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.entityScope')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.actions')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.help')
    expect(source).toContain('DASHBOARD_TOUR_TARGETS.navUser')
    expect(source).toContain('User menu')
    expect(source).toContain('Exports navigation')
    expect(source).toContain('Admin navigation')
    expect(source).toContain(
      'Workflow pages move certificates through Upload, Batches, Issues, Validated Results, and Reconciliation.',
    )
    expect(source).toContain(
      'The Exports section is where certificate PDFs are combined into packages for delivery or filing.',
    )
    expect(source).toContain(
      'Admin pages handle override requests, audit logs, and settings for users with access.',
    )
    expect(source).not.toContain('Output navigation')
    expect(source).not.toContain('Governance navigation')
    expect(source).toContain('openSidebarBeforeStep(')
    expect(source).toContain('setOpenMobile(true)')
    expect(source).toContain('setOpen(true)')
    expect(source).toContain('includeGovernance')
    expect(source).toContain("canAccessPath('/override-requests'")
    expect(source).toContain('tourId={PRODUCT_TOUR_IDS.dashboard}')
    expect(source).toContain('version={PRODUCT_TOUR_VERSIONS.dashboard}')
  })

  it('exports auto-start tours for the main app pages', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/product-tour.tsx'),
      'utf8',
    )

    const tourContracts = [
      ['BatchesTour', 'batches', 'BATCHES_TOUR_TARGETS.repositoryTabs'],
      [
        'BatchDetailTour',
        'batchDetail',
        'BATCH_DETAIL_TOUR_TARGETS.filesTable',
      ],
      ['IssuesTour', 'issues', 'ISSUES_TOUR_TARGETS.exportAction'],
      ['ValidatedTour', 'validated', 'VALIDATED_TOUR_TARGETS.filters'],
      [
        'ReconciliationTour',
        'reconciliation',
        'RECONCILIATION_TOUR_TARGETS.resultsExport',
      ],
      [
        'SalesReportTour',
        'salesReport',
        'SALES_REPORT_TOUR_TARGETS.resultsTable',
      ],
      ['SigningTour', 'signing', 'SIGNING_TOUR_TARGETS.certificateList'],
      ['MergePdfsTour', 'mergePdfs', 'MERGE_PDFS_TOUR_TARGETS.workflow'],
      ['OverridesTour', 'overrides', 'OVERRIDES_TOUR_TARGETS.statusTabs'],
      ['AuditTour', 'audit', 'AUDIT_TOUR_TARGETS.exportAction'],
      ['SettingsTour', 'settings', 'SETTINGS_TOUR_TARGETS.createUserAction'],
    ] as const

    for (const [componentName, tourIdKey, targetReference] of tourContracts) {
      expect(source).toContain(`export function ${componentName}`)
      expect(source).toContain(`tourId={PRODUCT_TOUR_IDS.${tourIdKey}}`)
      expect(source).toContain(`version={PRODUCT_TOUR_VERSIONS.${tourIdKey}}`)
      expect(source).toContain(targetReference)
    }

    expect(source).toContain('buildSettingsTourSteps')
    expect(source).not.toContain('includeDevReset')
    expect(source).not.toContain('SETTINGS_TOUR_TARGETS.devReset')
  })

  it('uses tab-aware hooks for the batch detail tour without opening overlays', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/product-tour.tsx'),
      'utf8',
    )

    expect(source).toContain('export function BatchDetailTour')
    expect(source).toContain('onTabTourChange')
    expect(source).toContain("tab: 'attention'")
    expect(source).toContain("tab: 'files'")
    expect(source).toContain('waitForProductTourTarget(targetId)')
    expect(source).toContain('tourId={PRODUCT_TOUR_IDS.batchDetail}')
    expect(source).toContain('version={PRODUCT_TOUR_VERSIONS.batchDetail}')
    expect(source).not.toContain('openBatchDetailSheet')
  })

  it('builds a sales report detail tour from stable loaded-page targets', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/product-tour.tsx'),
      'utf8',
    )

    expect(source).toContain('export function SalesReportTour')
    expect(source).toContain('buildSalesReportTourSteps')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.identity')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.batchSelection')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.parsedRowsTable')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.resultsTable')
    expect(source).toContain('tourId={PRODUCT_TOUR_IDS.salesReport}')
    expect(source).toContain('version={PRODUCT_TOUR_VERSIONS.salesReport}')
  })

  it('builds a signing workspace tour from stable loaded-page targets', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/product-tour.tsx'),
      'utf8',
    )

    expect(source).toContain('export function SigningTour')
    expect(source).toContain('buildSigningTourSteps')
    expect(source).toContain('SIGNING_TOUR_TARGETS.summary')
    expect(source).toContain('SIGNING_TOUR_TARGETS.toolbar')
    expect(source).toContain('SIGNING_TOUR_TARGETS.certificateList')
    expect(source).toContain('SIGNING_TOUR_TARGETS.previewControls')
    expect(source).toContain('SIGNING_TOUR_TARGETS.placement')
    expect(source).toContain('SIGNING_TOUR_TARGETS.profile')
    expect(source).toContain('tourId={PRODUCT_TOUR_IDS.signing}')
    expect(source).toContain('version={PRODUCT_TOUR_VERSIONS.signing}')
    expect(source).not.toContain('openSignatureProfileBeforeStep')
  })
})
