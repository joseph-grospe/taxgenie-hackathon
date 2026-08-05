import { describe, expect, it } from 'vitest'

import type {
  IntakeUploadView,
  LocalUploadItem,
  StatusSummary,
} from '@/lib/upload-intake-types'
import {
  buildCurrentUploadCardModel,
  buildJobsModel,
  buildNeedsAttentionItems,
  buildQueueMetrics,
  getLocalUploadProgressValue,
  getUploadProgressValue,
} from '@/lib/upload-intake-view-model'

const buildUpload = (
  overrides: Partial<IntakeUploadView> = {},
): IntakeUploadView => ({
  id: 'upload-1',
  batchId: 'batch-1',
  fileName: 'TLI_2307_Sample 2307-1-3.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1_700_000,
  uploadStatus: 'uploaded',
  queueStatus: 'queued',
  processingStatus: 'success',
  overallStatus: 'success',
  removedFromBatchAt: null,
  currentPhase: null,
  currentStep: null,
  errorMessage: null,
  uploadedAt: '2026-04-23T11:50:00.000Z',
  queuedAt: '2026-04-23T11:51:00.000Z',
  processingStartedAt: '2026-04-23T11:52:00.000Z',
  processingFinishedAt: '2026-04-23T11:53:00.000Z',
  storageKey: 'uploads/upload-1/sample.pdf',
  eventId: 'event-1',
  revision: 'rev-1',
  resultSummary: {
    detected: 1,
    validated: 1,
    skipped: null,
    errors: 0,
    totalPages: 4,
    source: 'batch_summary',
  },
  worker: null,
  result: null,
  ...overrides,
})

const buildLocalUpload = (
  overrides: Partial<LocalUploadItem> = {},
): LocalUploadItem => ({
  clientId: 'client-1',
  file: {
    name: 'ABC_April_Batch.pdf',
    size: 900_000,
  } as File,
  progress: 0,
  status: 'Pending',
  error: null,
  uploadId: null,
  batchId: null,
  ...overrides,
})

describe('upload-intake-view-model', () => {
  it('builds an empty current upload card model when there is no local or recent upload', () => {
    const model = buildCurrentUploadCardModel({
      localUpload: null,
      recentUploads: [],
    })

    expect(model.state).toBe('empty')
    expect(model.actions[0]?.id).toBe('select_file')
  })

  it('builds a completed current upload card model from the latest upload', () => {
    const model = buildCurrentUploadCardModel({
      localUpload: null,
      recentUploads: [buildUpload()],
    })

    expect(model.state).toBe('completed')
    expect(model.summaryChips.map((chip) => chip.label)).toEqual([
      'certificate',
      'validated',
    ])
  })

  it('builds a processing model from local upload and matched server state', () => {
    const model = buildCurrentUploadCardModel({
      localUpload: buildLocalUpload({
        status: 'Processing',
        uploadId: 'upload-1',
      }),
      recentUploads: [
        buildUpload({
          overallStatus: 'processing',
          processingStatus: 'processing',
          currentStep: 'validate_rules',
          processingFinishedAt: null,
        }),
      ],
    })

    expect(model.state).toBe('processing')
    expect(model.stages.some((stage) => stage.status === 'active')).toBe(true)
    expect(model.actions[0]?.id).toBe('view_details')
  })

  it('maps server upload progress across queue and worker steps', () => {
    expect(
      getUploadProgressValue(
        buildUpload({
          overallStatus: 'queued',
          queueStatus: 'queued',
          processingStatus: 'pending',
          currentStep: null,
          processingStartedAt: null,
          processingFinishedAt: null,
        }),
      ),
    ).toBe(45)

    const loadInput = getUploadProgressValue(
      buildUpload({
        overallStatus: 'processing',
        processingStatus: 'processing',
        currentStep: 'load_input',
        processingFinishedAt: null,
      }),
    )
    const extractDocument = getUploadProgressValue(
      buildUpload({
        overallStatus: 'processing',
        processingStatus: 'processing',
        currentStep: 'extract_document',
        processingFinishedAt: null,
      }),
    )
    const processCertificates = getUploadProgressValue(
      buildUpload({
        overallStatus: 'processing',
        processingStatus: 'processing',
        currentStep: 'process_certificates',
        processingFinishedAt: null,
      }),
    )
    const persistResults = getUploadProgressValue(
      buildUpload({
        overallStatus: 'processing',
        processingStatus: 'processing',
        currentStep: 'persist_results',
        processingFinishedAt: null,
      }),
    )
    const finalizeWorkflow = getUploadProgressValue(
      buildUpload({
        overallStatus: 'processing',
        processingStatus: 'processing',
        currentStep: 'finalize_workflow',
        processingFinishedAt: null,
      }),
    )

    expect(loadInput).toBeLessThan(extractDocument)
    expect(extractDocument).toBeLessThan(processCertificates)
    expect(processCertificates).toBeLessThan(persistResults)
    expect(persistResults).toBeLessThan(finalizeWorkflow)
    expect(finalizeWorkflow).toBeLessThan(100)
  })

  it('maps local upload transfer progress into the full intake pipeline', () => {
    expect(
      getLocalUploadProgressValue(
        buildLocalUpload({ status: 'Requesting', progress: 0 }),
      ),
    ).toBe(8)
    expect(
      getLocalUploadProgressValue(
        buildLocalUpload({ status: 'Uploading', progress: 100 }),
      ),
    ).toBe(35)
    expect(
      getLocalUploadProgressValue(
        buildLocalUpload({ status: 'Queueing', progress: 100 }),
      ),
    ).toBe(40)
    expect(
      getLocalUploadProgressValue(
        buildLocalUpload({ status: 'Queued', progress: 100 }),
      ),
    ).toBe(45)
  })

  it('prefers terminal server state over stale local processing state', () => {
    const model = buildCurrentUploadCardModel({
      localUpload: buildLocalUpload({
        status: 'Processing',
        uploadId: 'upload-1',
      }),
      recentUploads: [
        buildUpload({
          overallStatus: 'success',
          processingStatus: 'success',
        }),
      ],
    })

    expect(model.state).toBe('completed')
    expect(model.stages.every((stage) => stage.status === 'complete')).toBe(
      true,
    )
    expect(model.detailText).toBe('Latest job finished successfully.')
  })

  it('builds needs-attention items from duplicate and error uploads', () => {
    const items = buildNeedsAttentionItems([
      buildUpload({
        id: 'upload-duplicate',
        overallStatus: 'duplicate',
        processingStatus: 'duplicate',
        errorMessage: 'Duplicate confidence threshold exceeded.',
      }),
      buildUpload({
        id: 'upload-error',
        overallStatus: 'error',
        processingStatus: 'error',
        errorMessage: 'Validation failed.',
      }),
    ])

    expect(items).toHaveLength(2)
    expect(items[0]?.actionLabel).toBe('Review issue')
  })

  it('treats a validation-error result as an error', () => {
    const errorUpload = buildUpload({
      id: 'upload-validation-error',
      resultSummary: {
        detected: 1,
        validated: 0,
        skipped: null,
        errors: 1,
        totalPages: 1,
        source: 'results',
      },
      result: {
        status: 'error',
        documentType: 'BIR_2307',
        pageCount: 1,
        certificateCount: 1,
        reasonCodes: ['missing_signature'],
      },
    })

    const current = buildCurrentUploadCardModel({
      localUpload: null,
      recentUploads: [errorUpload],
    })
    const jobs = buildJobsModel({
      uploads: [errorUpload],
      activeTab: 'error',
      statusFilter: 'all',
      searchQuery: '',
    })
    const metrics = buildQueueMetrics(
      {
        pending: 0,
        uploaded: 0,
        queued: 0,
        processing: 0,
        success: 0,
        duplicate: 0,
        error: 1,
      },
      [errorUpload],
      1,
    )

    expect(current.state).toBe('error')
    expect(buildNeedsAttentionItems([errorUpload])).toMatchObject([
      { statusLabel: 'Error' },
    ])
    expect(jobs.rows).toMatchObject([
      {
        statusLabel: 'Error',
        statusFilter: 'error',
        actionId: 'review_issue',
      },
    ])
    expect(metrics[2]?.value).toBe(1)
    expect(metrics[3]?.value).toBe(0)
  })

  it('keeps duplicate uploads in needs-attention items and queue counts', () => {
    const summary: StatusSummary = {
      pending: 0,
      uploaded: 0,
      queued: 0,
      processing: 0,
      success: 0,
      duplicate: 1,
      error: 0,
    }

    const uploads = [
      buildUpload({
        id: 'upload-duplicate',
        overallStatus: 'duplicate',
        processingStatus: 'duplicate',
        errorMessage: 'Duplicate confidence threshold exceeded.',
      }),
    ]

    expect(buildNeedsAttentionItems(uploads)).toHaveLength(1)
    expect(buildQueueMetrics(summary, uploads)[3]?.value).toBe(1)
  })

  it('builds queue metrics and jobs rows from recent uploads', () => {
    const summary: StatusSummary = {
      pending: 0,
      uploaded: 0,
      queued: 1,
      processing: 1,
      success: 1,
      duplicate: 1,
      error: 0,
    }
    const uploads = [
      buildUpload(),
      buildUpload({
        id: 'upload-processing',
        fileName: 'ABC_April_Batch.pdf',
        overallStatus: 'processing',
        processingStatus: 'processing',
        currentStep: 'extract_document',
        processingFinishedAt: null,
        resultSummary: {
          detected: null,
          validated: 0,
          skipped: null,
          errors: 0,
          totalPages: null,
          source: 'results',
        },
      }),
      buildUpload({
        id: 'upload-review',
        fileName: 'XYZ_2307_March.pdf',
        overallStatus: 'duplicate',
        processingStatus: 'duplicate',
        resultSummary: {
          detected: null,
          validated: 0,
          skipped: null,
          errors: 0,
          totalPages: null,
          source: 'results',
        },
      }),
    ]

    const metrics = buildQueueMetrics(summary, uploads, 1)
    const jobs = buildJobsModel({
      uploads,
      activeTab: 'duplicate',
      statusFilter: 'all',
      searchQuery: 'XYZ',
    })

    expect(metrics[2]?.value).toBe(0)
    expect(metrics[3]?.value).toBe(1)
    expect(jobs.rows).toHaveLength(1)
    expect(jobs.rows[0]?.actionLabel).toBe('Review issue')
  })

  it('keeps error uploads in the error jobs tab', () => {
    const jobs = buildJobsModel({
      uploads: [
        buildUpload({
          id: 'upload-error',
          overallStatus: 'error',
          processingStatus: 'error',
          errorMessage: 'Validation failed.',
        }),
      ],
      activeTab: 'error',
      statusFilter: 'all',
      searchQuery: '',
    })

    expect(jobs.rows).toHaveLength(1)
    expect(jobs.counts.error).toBe(1)
  })

  it('formats job activity timestamps in Manila time', () => {
    const timestamp = '2026-04-23T16:05:00.000Z'
    const jobs = buildJobsModel({
      uploads: [
        buildUpload({
          processingFinishedAt: timestamp,
        }),
      ],
      activeTab: 'all',
      statusFilter: 'all',
      searchQuery: '',
    })
    const expectedManilaLabel = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Manila',
    }).format(new Date(timestamp))
    const utcLabel = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(timestamp))

    expect(jobs.rows[0]?.updatedAt).toBe(expectedManilaLabel)
    expect(jobs.rows[0]?.updatedAt).not.toBe(utcLabel)
  })

  it('shows duplicate and error uploads as reviewable in the jobs list', () => {
    const jobs = buildJobsModel({
      uploads: [
        buildUpload({
          id: 'upload-duplicate',
          overallStatus: 'duplicate',
          processingStatus: 'duplicate',
          errorMessage: 'Duplicate confidence threshold exceeded.',
        }),
        buildUpload({
          id: 'upload-error',
          overallStatus: 'error',
          processingStatus: 'error',
          errorMessage: 'Validation failed.',
        }),
      ],
      activeTab: 'all',
      statusFilter: 'all',
      searchQuery: '',
    })

    expect(jobs.rows).toHaveLength(2)
    expect(jobs.rows[0]?.statusLabel).toBe('Duplicate')
    expect(jobs.rows[0]?.actionLabel).toBe('Review issue')
    expect(jobs.rows[1]?.statusLabel).toBe('Error')
    expect(jobs.rows[1]?.actionLabel).toBe('Review issue')
  })

  it('filters errors and duplicates independently', () => {
    const uploads = [
      buildUpload({
        id: 'upload-duplicate',
        overallStatus: 'duplicate',
        processingStatus: 'duplicate',
        errorMessage: 'Duplicate confidence threshold exceeded.',
      }),
      buildUpload({
        id: 'upload-error',
        overallStatus: 'error',
        processingStatus: 'error',
        errorMessage: 'Validation failed.',
      }),
    ]

    const duplicateJobs = buildJobsModel({
      uploads,
      activeTab: 'all',
      statusFilter: 'duplicate',
      searchQuery: '',
    })
    const failedJobs = buildJobsModel({
      uploads,
      activeTab: 'all',
      statusFilter: 'error',
      searchQuery: '',
    })

    expect(duplicateJobs.rows).toHaveLength(1)
    expect(duplicateJobs.rows[0]?.statusLabel).toBe('Duplicate')
    expect(failedJobs.rows).toHaveLength(1)
    expect(failedJobs.rows[0]?.statusLabel).toBe('Error')
  })
})
