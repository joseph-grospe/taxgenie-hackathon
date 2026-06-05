import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8')

describe('detail page product tour wiring', () => {
  it('wires the shared batch detail route to loaded-data Help restart', () => {
    const source = readSource('src/components/batch-detail-route-content.tsx')

    expect(source).toContain('tourStartSignal')
    expect(source).toContain('Guide me through this batch')
    expect(source).toContain('shouldShowBatchTour')
    expect(source).toContain('Boolean(uploadBatch && !loadError)')
    expect(source).toContain('BATCH_DETAIL_TOUR_TARGETS.backAction')
    expect(source).toContain('BATCH_DETAIL_TOUR_TARGETS.title')
    expect(source).toContain('<BatchDetailTour')
    expect(source).toContain('onTabTourChange={changeTourTab}')
    expect(source).toContain('startSignal={tourStartSignal}')
  })

  it('exposes stable batch detail targets on visible panels', () => {
    const source = readSource('src/components/upload-batch-detail-page.tsx')

    expect(source).toContain('tourTargets?: UploadBatchDetailTourTargets')
    expect(source).toContain('tourTargets?.tabs')
    expect(source).toContain('tourTargets?.actions')
    expect(source).toContain('tourTargets?.details')
    expect(source).toContain('tourTargets?.outcomeSummary')
    expect(source).toContain('tourTarget={tourTargets?.attention}')
    expect(source).toContain('tourTargets?.filesFilters')
    expect(source).toContain('tourTargets?.filesTable')
    expect(source).toContain('tourTargets?.filesPagination')
  })

  it('wires the sales report detail route to loaded-report Help restart', () => {
    const source = readSource('src/routes/reconciliation.reports.$reportId.tsx')

    expect(source).toContain('tourStartSignal')
    expect(source).toContain('Guide me through this sales report')
    expect(source).toContain('pageHelp={')
    expect(source).toContain('report')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.backAction')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.title')
    expect(source).toContain('tourTarget={SALES_REPORT_TOUR_TARGETS.identity}')
    expect(source).toContain('tourTarget={SALES_REPORT_TOUR_TARGETS.actions}')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.batchSelection')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.runStatus')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.parsedRowsFilters')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.parsedRowsTable')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.resultsFilters')
    expect(source).toContain('SALES_REPORT_TOUR_TARGETS.resultsTable')
    expect(source).toContain('<SalesReportTour startSignal={tourStartSignal} />')
  })

  it('keeps active reconciliation result target optional for shared callers', () => {
    const source = readSource('src/components/reconciliation-results-table.tsx')

    expect(source).toContain('tourTarget?: string')
    expect(source).toContain('getOptionalTourTargetProps(tourTarget)')
  })
})
