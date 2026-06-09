import { describe, expect, it, vi } from 'vitest'

import {
  AUDIT_TOUR_TARGETS,
  BATCHES_TOUR_TARGETS,
  BATCH_DETAIL_TOUR_TARGETS,
  DASHBOARD_TOUR_TARGETS,
  ISSUES_TOUR_TARGETS,
  MERGE_PDFS_TOUR_TARGETS,
  OVERRIDES_TOUR_TARGETS,
  PRODUCT_TOURS_STORAGE_KEY,
  PRODUCT_TOUR_IDS,
  PRODUCT_TOUR_VERSIONS,
  RECONCILIATION_TOUR_TARGETS,
  SALES_REPORT_TOUR_TARGETS,
  SETTINGS_TOUR_TARGETS,
  SIGNING_TOUR_TARGETS,
  VALIDATED_TOUR_TARGETS,
  hasCompletedProductTour,
  markProductTourCompleted,
  readProductTourState,
  resetProductTour,
} from '@/lib/product-tours'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const blockedStorage = (): Storage =>
  ({
    clear: vi.fn(),
    getItem: vi.fn(() => {
      throw new Error('blocked')
    }),
    key: vi.fn(),
    length: 0,
    removeItem: vi.fn(),
    setItem: vi.fn(() => {
      throw new Error('blocked')
    }),
  }) as unknown as Storage

describe('product tour storage helpers', () => {
  it('defines separate upload and dashboard tour contracts', () => {
    expect(PRODUCT_TOUR_IDS).toMatchObject({
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
    })
    expect(PRODUCT_TOUR_VERSIONS).toMatchObject({
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
    })
    expect(DASHBOARD_TOUR_TARGETS).toMatchObject({
      actions: 'dashboard.actions',
      navGovernance: 'dashboard.nav.governance',
      navUser: 'dashboard.nav.user',
      reportingPeriod: 'dashboard.reportingPeriod',
      sidebarTrigger: 'dashboard.sidebarTrigger',
      validatedDocuments: 'dashboard.validatedDocuments',
    })
    expect(BATCHES_TOUR_TARGETS).toMatchObject({
      filters: 'batches.filters',
      repositoryTabs: 'batches.repositoryTabs',
      table: 'batches.table',
      title: 'batches.title',
    })
    expect(BATCH_DETAIL_TOUR_TARGETS).toMatchObject({
      actions: 'batchDetail.actions',
      backAction: 'batchDetail.backAction',
      filesFilters: 'batchDetail.filesFilters',
      filesPagination: 'batchDetail.filesPagination',
      filesTable: 'batchDetail.filesTable',
      outcomeSummary: 'batchDetail.outcomeSummary',
      title: 'batchDetail.title',
    })
    expect(ISSUES_TOUR_TARGETS).toMatchObject({
      exportAction: 'issues.exportAction',
      statusTabs: 'issues.statusTabs',
      table: 'issues.table',
    })
    expect(VALIDATED_TOUR_TARGETS).toMatchObject({
      filters: 'validated.filters',
      pagination: 'validated.pagination',
      table: 'validated.table',
    })
    expect(RECONCILIATION_TOUR_TARGETS).toMatchObject({
      resultsExport: 'reconciliation.resultsExport',
      salesReports: 'reconciliation.salesReports',
      title: 'reconciliation.title',
    })
    expect(SALES_REPORT_TOUR_TARGETS).toMatchObject({
      actions: 'salesReport.actions',
      backAction: 'salesReport.backAction',
      batchSelection: 'salesReport.batchSelection',
      parsedRowsTable: 'salesReport.parsedRowsTable',
      resultsTable: 'salesReport.resultsTable',
      title: 'salesReport.title',
    })
    expect(SIGNING_TOUR_TARGETS).toMatchObject({
      backAction: 'signing.backAction',
      certificateList: 'signing.certificateList',
      placement: 'signing.placement',
      preview: 'signing.preview',
      profile: 'signing.profile',
      title: 'signing.title',
      toolbar: 'signing.toolbar',
    })
    expect(MERGE_PDFS_TOUR_TARGETS).toMatchObject({
      controls: 'mergePdfs.controls',
      recentJobs: 'mergePdfs.recentJobs',
      workflow: 'mergePdfs.workflow',
    })
    expect(OVERRIDES_TOUR_TARGETS).toMatchObject({
      search: 'overrides.search',
      statusTabs: 'overrides.statusTabs',
      table: 'overrides.table',
    })
    expect(AUDIT_TOUR_TARGETS).toMatchObject({
      exportAction: 'audit.exportAction',
      filters: 'audit.filters',
      table: 'audit.table',
    })
    expect(SETTINGS_TOUR_TARGETS).toMatchObject({
      createUserAction: 'settings.createUserAction',
      roleMatrix: 'settings.roleMatrix',
      usersTable: 'settings.usersTable',
    })
  })

  it('falls back to an empty state when storage cannot be read', () => {
    expect(readProductTourState(blockedStorage())).toEqual({
      completedTours: {},
    })
  })

  it('marks the current tour version complete', () => {
    const storage = new MemoryStorage()

    markProductTourCompleted({
      completedAt: '2026-06-05T00:00:00.000Z',
      storage,
      tourId: PRODUCT_TOUR_IDS.upload,
      version: 1,
    })

    expect(
      hasCompletedProductTour({
        storage,
        tourId: PRODUCT_TOUR_IDS.upload,
        version: 1,
      }),
    ).toBe(true)
    expect(
      JSON.parse(storage.getItem(PRODUCT_TOURS_STORAGE_KEY) ?? '{}'),
    ).toEqual({
      completedTours: {
        upload: {
          completedAt: '2026-06-05T00:00:00.000Z',
          version: 1,
        },
      },
    })
  })

  it('treats older completed versions as incomplete', () => {
    const storage = new MemoryStorage()

    markProductTourCompleted({
      storage,
      tourId: PRODUCT_TOUR_IDS.upload,
      version: 1,
    })

    expect(
      hasCompletedProductTour({
        storage,
        tourId: PRODUCT_TOUR_IDS.upload,
        version: 2,
      }),
    ).toBe(false)
  })

  it('can reset a completed tour without removing other tour state', () => {
    const storage = new MemoryStorage()

    storage.setItem(
      PRODUCT_TOURS_STORAGE_KEY,
      JSON.stringify({
        completedTours: {
          other: { completedAt: '2026-06-05T00:00:00.000Z', version: 1 },
          upload: { completedAt: '2026-06-05T00:00:00.000Z', version: 1 },
        },
      }),
    )

    resetProductTour({ storage, tourId: PRODUCT_TOUR_IDS.upload })

    expect(readProductTourState(storage)).toEqual({
      completedTours: {
        other: { completedAt: '2026-06-05T00:00:00.000Z', version: 1 },
      },
    })
  })

  it('keeps dashboard and upload completion state independent', () => {
    const storage = new MemoryStorage()

    markProductTourCompleted({
      completedAt: '2026-06-05T00:00:00.000Z',
      storage,
      tourId: PRODUCT_TOUR_IDS.upload,
      version: PRODUCT_TOUR_VERSIONS.upload,
    })
    markProductTourCompleted({
      completedAt: '2026-06-05T00:01:00.000Z',
      storage,
      tourId: PRODUCT_TOUR_IDS.dashboard,
      version: PRODUCT_TOUR_VERSIONS.dashboard,
    })

    resetProductTour({ storage, tourId: PRODUCT_TOUR_IDS.dashboard })

    expect(
      hasCompletedProductTour({
        storage,
        tourId: PRODUCT_TOUR_IDS.upload,
        version: PRODUCT_TOUR_VERSIONS.upload,
      }),
    ).toBe(true)
    expect(
      hasCompletedProductTour({
        storage,
        tourId: PRODUCT_TOUR_IDS.dashboard,
        version: PRODUCT_TOUR_VERSIONS.dashboard,
      }),
    ).toBe(false)
  })

  it('keeps main page tour completion state independent', () => {
    const storage = new MemoryStorage()

    markProductTourCompleted({
      completedAt: '2026-06-05T00:00:00.000Z',
      storage,
      tourId: PRODUCT_TOUR_IDS.upload,
      version: PRODUCT_TOUR_VERSIONS.upload,
    })
    markProductTourCompleted({
      completedAt: '2026-06-05T00:01:00.000Z',
      storage,
      tourId: PRODUCT_TOUR_IDS.batches,
      version: PRODUCT_TOUR_VERSIONS.batches,
    })
    markProductTourCompleted({
      completedAt: '2026-06-05T00:02:00.000Z',
      storage,
      tourId: PRODUCT_TOUR_IDS.audit,
      version: PRODUCT_TOUR_VERSIONS.audit,
    })
    markProductTourCompleted({
      completedAt: '2026-06-05T00:03:00.000Z',
      storage,
      tourId: PRODUCT_TOUR_IDS.batchDetail,
      version: PRODUCT_TOUR_VERSIONS.batchDetail,
    })
    markProductTourCompleted({
      completedAt: '2026-06-05T00:04:00.000Z',
      storage,
      tourId: PRODUCT_TOUR_IDS.salesReport,
      version: PRODUCT_TOUR_VERSIONS.salesReport,
    })
    markProductTourCompleted({
      completedAt: '2026-06-05T00:05:00.000Z',
      storage,
      tourId: PRODUCT_TOUR_IDS.signing,
      version: PRODUCT_TOUR_VERSIONS.signing,
    })

    resetProductTour({ storage, tourId: PRODUCT_TOUR_IDS.batches })
    resetProductTour({ storage, tourId: PRODUCT_TOUR_IDS.batchDetail })

    expect(
      hasCompletedProductTour({
        storage,
        tourId: PRODUCT_TOUR_IDS.upload,
        version: PRODUCT_TOUR_VERSIONS.upload,
      }),
    ).toBe(true)
    expect(
      hasCompletedProductTour({
        storage,
        tourId: PRODUCT_TOUR_IDS.batches,
        version: PRODUCT_TOUR_VERSIONS.batches,
      }),
    ).toBe(false)
    expect(
      hasCompletedProductTour({
        storage,
        tourId: PRODUCT_TOUR_IDS.audit,
        version: PRODUCT_TOUR_VERSIONS.audit,
      }),
    ).toBe(true)
    expect(
      hasCompletedProductTour({
        storage,
        tourId: PRODUCT_TOUR_IDS.batchDetail,
        version: PRODUCT_TOUR_VERSIONS.batchDetail,
      }),
    ).toBe(false)
    expect(
      hasCompletedProductTour({
        storage,
        tourId: PRODUCT_TOUR_IDS.salesReport,
        version: PRODUCT_TOUR_VERSIONS.salesReport,
      }),
    ).toBe(true)
    expect(
      hasCompletedProductTour({
        storage,
        tourId: PRODUCT_TOUR_IDS.signing,
        version: PRODUCT_TOUR_VERSIONS.signing,
      }),
    ).toBe(true)
  })

  it('does not throw when storage cannot be written', () => {
    expect(() =>
      markProductTourCompleted({
        storage: blockedStorage(),
        tourId: PRODUCT_TOUR_IDS.upload,
        version: 1,
      }),
    ).not.toThrow()
  })
})
