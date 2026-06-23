import { describe, expect, it } from 'vitest'

import type { OperationalDocumentView } from '@/lib/documents-types'
import type {
  ListIssueDocumentsOptions,
  ListValidatedDocumentsOptions,
} from '@/lib/documents-server'
import {
  applyNormalizedPatchToPayload,
  buildDocumentTrail,
  buildDocumentTrailDetails,
  buildIssueDocumentsExport,
  buildIssueDocumentsListResult,
  buildNextExtractedFieldsOverridePatch,
  buildNormalizedExtractedFieldsPatch,
  buildReconciliationTrailStep,
  buildSigningTrailStep,
  buildValidatedDocumentsListResult,
  getDocumentResultNormalizedPayload,
  hasEditableCertificatePayload,
} from '@/lib/documents-server'

describe('document lifecycle trail helpers', () => {
  it('keeps validated persistence pending when validation rules fail', () => {
    const createdAt = new Date('2026-04-29T15:44:00.000Z')
    const fileRecord = {
      uploadStatus: 'uploaded',
      queueStatus: 'queued',
      processingStatus: 'error',
      errorMessage: null,
      uploadedAt: createdAt,
      createdAt,
      queuedAt: createdAt,
      processingFinishedAt: createdAt,
    } as Parameters<typeof buildDocumentTrail>[0]
    const jobRecord = {
      status: 'error',
      currentStep: 'complete',
      updatedAt: createdAt,
      finishedAt: createdAt,
    } as Parameters<typeof buildDocumentTrail>[1]
    const steps = [
      { stepName: 'load_input', status: 'success', createdAt },
      { stepName: 'extract_document', status: 'success', createdAt },
      { stepName: 'normalize_fields', status: 'success', createdAt },
      {
        stepName: 'validate_rules',
        status: 'error',
        metadata: {
          phase: 'validate',
          route: 'error',
          reasonCodes: ['missing_printed_name', 'missing_signature'],
        },
        createdAt,
      },
      {
        stepName: 'persist_validation_fail',
        status: 'error',
        metadata: {
          phase: 'persist',
          route: 'error',
          reasonCodes: ['missing_printed_name', 'missing_signature'],
        },
        createdAt,
      },
      {
        stepName: 'finalize_workflow',
        status: 'error',
        metadata: {
          phase: 'persist',
          route: 'error',
          reasonCodes: ['missing_printed_name', 'missing_signature'],
        },
        createdAt,
      },
    ] as Parameters<typeof buildDocumentTrail>[4]
    const issueReason = 'Missing Printed Name; Missing Signature'

    const trail = buildDocumentTrail(
      fileRecord,
      jobRecord,
      'Error',
      issueReason,
      steps,
    )
    const details = buildDocumentTrailDetails(
      fileRecord,
      jobRecord,
      trail,
      issueReason,
      steps,
    )

    expect(trail).toEqual([
      { label: 'Uploaded', status: 'complete' },
      { label: 'Queued', status: 'complete' },
      { label: 'OCR / Layout', status: 'complete' },
      { label: 'AI Normalize', status: 'complete' },
      { label: 'Validation + Variance', status: 'error' },
      { label: 'Masterlist Check', status: 'pending' },
      { label: 'Deduplication', status: 'pending' },
      { label: 'Rename + Persist', status: 'pending' },
      { label: 'Reconciliation', status: 'pending' },
      { label: 'Signing', status: 'pending' },
    ])
    expect(
      details.find((detail) => detail.label === 'Validation + Variance'),
    ).toMatchObject({
      status: 'error',
      description: issueReason,
    })
    expect(
      details.find((detail) => detail.label === 'Rename + Persist'),
    ).toMatchObject({
      timestamp: '—',
      status: 'pending',
      description: 'Waiting for rename + persist.',
    })
  })

  it('derives reconciliation status from reconciliation records', () => {
    expect(buildReconciliationTrailStep('Processing')).toEqual({
      label: 'Reconciliation',
      status: 'pending',
    })

    expect(buildReconciliationTrailStep('Ready')).toEqual({
      label: 'Reconciliation',
      status: 'active',
      detail: 'Ready for reconciliation.',
    })

    expect(
      buildReconciliationTrailStep('Ready', {
        matchStatus: 'matched',
        hasDifference: false,
        createdAt: new Date('2026-04-28T10:00:00.000Z'),
      }),
    ).toEqual({
      label: 'Reconciliation',
      status: 'complete',
      detail: 'Reconciliation matched.',
    })

    expect(
      buildReconciliationTrailStep('Ready', {
        matchStatus: 'matched',
        hasDifference: true,
        createdAt: new Date('2026-04-28T10:00:00.000Z'),
      }),
    ).toEqual({
      label: 'Reconciliation',
      status: 'complete',
      detail: 'Reconciliation completed with variance.',
    })

    expect(
      buildReconciliationTrailStep('Ready', {
        matchStatus: 'unmatched',
        hasDifference: true,
        createdAt: new Date('2026-04-28T10:00:00.000Z'),
      }),
    ).toEqual({
      label: 'Reconciliation',
      status: 'error',
      detail: 'Reconciliation did not match this certificate.',
    })
  })

  it('derives signing status from batch signing state', () => {
    expect(buildSigningTrailStep('Ready', { canSign: true })).toEqual({
      label: 'Signing',
      status: 'active',
      detail: 'Ready for batch signing.',
    })

    expect(
      buildSigningTrailStep('Ready', {
        signingSummary: {
          signingStatus: 'signed',
          signedAt: 'Apr 28, 2026, 10:00 AM',
          signedByName: 'Jane Doe',
        },
      }),
    ).toEqual({
      label: 'Signing',
      status: 'complete',
      detail: 'Signed by Jane Doe.',
    })

    expect(
      buildSigningTrailStep('Ready', {
        signingSummary: {
          signingStatus: 'failed',
        },
      }),
    ).toEqual({
      label: 'Signing',
      status: 'error',
      detail: 'Signing failed.',
    })
  })
})

const createDocument = (
  overrides: Partial<OperationalDocumentView>,
): OperationalDocumentView => ({
  id: overrides.id ?? '1',
  documentResultId: overrides.documentResultId,
  kind: overrides.kind ?? 'certificate',
  uploadId: overrides.uploadId ?? `upload-${overrides.id ?? '1'}`,
  uploadBatchId: overrides.uploadBatchId ?? 'batch-1',
  fileName: overrides.fileName ?? `validated-${overrides.id ?? '1'}.pdf`,
  status: overrides.status ?? 'Ready',
  stage: overrides.stage ?? 'Validated',
  nextStep: overrides.nextStep ?? 'Review or export',
  payee: overrides.payee ?? 'Payee',
  payorName: overrides.payorName ?? 'Customer',
  period: overrides.period ?? 'December 2025',
  atc: overrides.atc ?? 'WC160',
  taxBase: overrides.taxBase ?? '10,000.00',
  taxWithheld: overrides.taxWithheld ?? '200.00',
  confidence: overrides.confidence ?? '0.95',
  year: overrides.year ?? '2025',
  month: overrides.month ?? 'December',
  quarter: overrides.quarter ?? 'Q4',
  entity: overrides.entity ?? 'AESI',
  customerType: overrides.customerType ?? 'BIR 2307',
  errorTypes: overrides.errorTypes ?? ['None'],
  issueReason: overrides.issueReason ?? '',
  severity: overrides.severity ?? 'low',
  owner: overrides.owner ?? 'Ada Admin',
  updatedAt: overrides.updatedAt ?? 'May 8, 2026',
  uploadedAt: overrides.uploadedAt,
  trail: overrides.trail ?? [],
  logs: overrides.logs ?? [],
  errors: overrides.errors ?? [],
  validationChecks: overrides.validationChecks ?? [],
  reviewFields: overrides.reviewFields ?? [],
  canSign: overrides.canSign ?? false,
  signingStatus: overrides.signingStatus ?? 'unsigned',
  hasSavedTemplatePlacement: overrides.hasSavedTemplatePlacement ?? false,
})

const defaultInput: ListValidatedDocumentsOptions = {
  q: '',
  year: '',
  month: '',
  quarter: '',
  entity: '',
  customerType: '',
  customerName: '',
  errorType: '',
  atc: '',
  sortBy: 'amount',
  sortDir: 'desc',
  page: 1,
  pageSize: 25,
}

const defaultIssueInput: ListIssueDocumentsOptions = {
  status: 'all',
  q: '',
  severity: '',
  owner: '',
  entity: '',
  year: '',
  month: '',
  quarter: '',
  dateFrom: '',
  dateTo: '',
  page: 1,
  pageSize: 25,
}

describe('validated document listing', () => {
  it('filters by exact entity before paginating and returns matching summaries', () => {
    const documents = [
      createDocument({
        id: '1',
        entity: 'AES',
        payorName: 'Alpha Power',
        taxWithheld: '500.00',
        signingStatus: 'signed',
      }),
      createDocument({
        id: '2',
        entity: 'AESI',
        payorName: 'Bravo Energy',
        taxWithheld: '700.00',
      }),
      createDocument({
        id: '3',
        entity: 'AESI',
        payorName: 'Charlie Grid',
        taxWithheld: '900.00',
        signingStatus: 'signed',
      }),
    ]

    const result = buildValidatedDocumentsListResult(documents, {
      ...defaultInput,
      entity: 'AESI',
      pageSize: 1,
    })

    expect(result.documents.map((document) => document.id)).toEqual(['3'])
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    })
    expect(result.summary).toEqual({
      totalValidated: 2,
      certificateCount: 2,
      signedPdfCount: 1,
    })
    expect(result.filterOptions.year).toEqual(['2025'])
  })

  it('combines text, date, facet filters, sorting, and page offsets', () => {
    const documents = [
      createDocument({
        id: '1',
        payorName: 'Solaris Grid',
        period: 'November 2025',
        month: 'November',
        quarter: 'Q4',
        atc: 'WC160',
        taxWithheld: '300.00',
      }),
      createDocument({
        id: '2',
        payorName: 'Solaris Retail',
        period: 'December 2025',
        atc: 'WC160',
        taxWithheld: '100.00',
      }),
      createDocument({
        id: '3',
        payorName: 'Metro Energy',
        period: 'December 2025',
        atc: 'WC158',
        taxWithheld: '900.00',
      }),
    ]

    const result = buildValidatedDocumentsListResult(documents, {
      ...defaultInput,
      q: 'solaris',
      year: '2025-11-01',
      month: '2025-12-31',
      atc: 'WC160',
      sortBy: 'amount',
      sortDir: 'asc',
      page: 2,
      pageSize: 1,
    })

    expect(result.documents.map((document) => document.id)).toEqual(['1'])
    expect(result.pagination).toMatchObject({
      page: 2,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    })
  })
})

describe('validated extracted field updates', () => {
  it('normalizes changed extracted fields and rejects no-op submissions', () => {
    const currentNormalized = {
      payorName: 'Original Customer',
      taxWithheld: 200,
      signaturePresent: false,
      monthOfQuarter: 'first',
    }

    expect(
      buildNormalizedExtractedFieldsPatch(currentNormalized, {
        payorName: 'Updated Customer',
        taxWithheld: '1,250.50',
        signaturePresent: 'yes',
        monthOfQuarter: 'Third',
      }),
    ).toEqual({
      payorName: 'Updated Customer',
      taxWithheld: 1250.5,
      signaturePresent: true,
      monthOfQuarter: 'third',
    })

    expect(() =>
      buildNormalizedExtractedFieldsPatch(currentNormalized, {
        payorName: 'Original Customer',
      }),
    ).toThrow('No extracted field changes were submitted.')
  })

  it('validates month of quarter edits', () => {
    expect(
      buildNormalizedExtractedFieldsPatch(
        { monthOfQuarter: 'second' },
        { monthOfQuarter: '' },
      ),
    ).toEqual({
      monthOfQuarter: null,
    })

    expect(() =>
      buildNormalizedExtractedFieldsPatch(
        { monthOfQuarter: 'second' },
        { monthOfQuarter: 'fourth' },
      ),
    ).toThrow('Month of quarter must be first, second, or third.')
  })

  it('stores virtual period start edits as a formatted period covered range', () => {
    const currentNormalized = {
      periodCovered: '08-01-2025 to 08-31-2025',
      periodEnd: '08-31-2025',
    }

    expect(
      buildNormalizedExtractedFieldsPatch(currentNormalized, {
        periodStart: '2025-09-01',
        periodEnd: '2025-09-30',
      }),
    ).toEqual({
      periodStart: '09-01-2025',
      periodCovered: '09-01-2025 to 09-30-2025',
      periodEnd: '09-30-2025',
    })
  })

  it('uses an existing normalized period start when rebuilding period covered', () => {
    const currentNormalized = {
      periodStart: '08-05-2025',
      periodCovered: '08-01-2025 to 08-31-2025',
      periodEnd: '08-31-2025',
    }

    expect(
      buildNormalizedExtractedFieldsPatch(currentNormalized, {
        periodEnd: '2025-09-30',
      }),
    ).toEqual({
      periodCovered: '08-05-2025 to 09-30-2025',
      periodEnd: '09-30-2025',
    })
  })

  it('validates virtual period start as a real date', () => {
    expect(() =>
      buildNormalizedExtractedFieldsPatch(
        {
          periodCovered: '08-01-2025 to 08-31-2025',
          periodEnd: '08-31-2025',
        },
        {
          periodStart: 'not a date',
        },
      ),
    ).toThrow('Period start must be a valid date.')

    expect(() =>
      buildNormalizedExtractedFieldsPatch(
        {
          periodCovered: '08-01-2025 to 08-31-2025',
          periodEnd: '08-31-2025',
        },
        {
          periodStart: '2025-09-30',
          periodEnd: '2025-09-01',
        },
      ),
    ).toThrow('Period start must be on or before period end.')
  })

  it('rejects unknown extracted field keys', () => {
    expect(() =>
      buildNormalizedExtractedFieldsPatch(
        {},
        {
          unknownField: 'value',
        },
      ),
    ).toThrow('Unknown extracted field: unknownField.')
  })

  it('stores first-seen originals while keeping edited current values', () => {
    const overridePatch = buildNextExtractedFieldsOverridePatch({
      existingOverridePatch: {
        status: 'approved',
      },
      currentNormalized: {
        payorName: 'Original Customer',
        taxWithheld: 200,
      },
      normalizedPatch: {
        payorName: 'Updated Customer',
        taxWithheld: 300,
      },
      editedAt: '2026-06-05T01:00:00.000Z',
      editedByUserId: 'user-1',
    })

    expect(overridePatch).toMatchObject({
      status: 'approved',
      extractedFields: {
        status: 'edited',
        editedAt: '2026-06-05T01:00:00.000Z',
        editedByUserId: 'user-1',
        originalValues: {
          payorName: 'Original Customer',
          taxWithheld: 200,
        },
        values: {
          payorName: 'Updated Customer',
          taxWithheld: 300,
        },
      },
    })
  })

  it('updates top-level and first certificate page normalized payload values', () => {
    const payload = applyNormalizedPatchToPayload(
      {
        normalized: {
          payorName: 'Top-level Customer',
        },
        pages: [
          {
            classification: 'non_certificate',
            normalized: {
              payorName: 'Ignored Customer',
            },
          },
          {
            classification: 'certificate',
            normalized: {
              payorName: 'First Certificate Customer',
              taxWithheld: 200,
            },
          },
          {
            classification: 'certificate',
            normalized: {
              payorName: 'Second Certificate Customer',
            },
          },
        ],
      },
      {
        payorName: 'Updated Customer',
      },
    )

    expect(payload).toMatchObject({
      normalized: {
        payorName: 'Updated Customer',
      },
      pages: [
        {
          classification: 'non_certificate',
          normalized: {
            payorName: 'Ignored Customer',
          },
        },
        {
          classification: 'certificate',
          normalized: {
            payorName: 'Updated Customer',
            taxWithheld: 200,
          },
        },
        {
          classification: 'certificate',
          normalized: {
            payorName: 'Second Certificate Customer',
          },
        },
      ],
    })
  })

  it('identifies editable certificate payloads from persisted page classifications', () => {
    expect(
      hasEditableCertificatePayload({
        normalized: {
          payorName: 'Top-level Customer',
        },
        pages: [
          {
            classification: 'non_certificate',
            normalized: {
              payorName: 'Ignored Customer',
            },
          },
          {
            classification: 'certificate',
            normalized: {
              payorName: 'Certificate Customer',
            },
          },
        ],
      }),
    ).toBe(true)

    expect(
      hasEditableCertificatePayload({
        normalized: {
          payorName: 'Non-certificate Customer',
        },
        pages: [
          {
            classification: 'non_certificate',
            normalized: {
              payorName: 'Non-certificate Customer',
            },
          },
        ],
      }),
    ).toBe(false)
  })
})

describe('issue document listing', () => {
  it('filters by status after computing filtered issue summary counts', () => {
    const documents = [
      createDocument({
        id: '1',
        status: 'Error',
        issueReason: 'Missing TIN',
        severity: 'High',
        owner: 'Revenue Ops',
        entity: 'AESI',
        updatedAt: 'May 01, 2026',
      }),
      createDocument({
        id: '2',
        status: 'Duplicate',
        issueReason: 'Duplicate certificate',
        severity: 'Low',
        owner: 'Revenue Ops',
        entity: 'AESI',
        updatedAt: 'May 02, 2026',
      }),
      createDocument({
        id: '3',
        status: 'Error',
        issueReason: 'Missing Signature',
        severity: 'High',
        owner: 'Tax Desk',
        entity: 'TMO',
        updatedAt: 'May 03, 2026',
      }),
    ]

    const result = buildIssueDocumentsListResult(documents, {
      ...defaultIssueInput,
      status: 'duplicate',
      owner: 'Revenue Ops',
    })

    expect(result.documents.map((document) => document.id)).toEqual(['2'])
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 25,
      totalItems: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    })
    expect(result.summary).toEqual({
      totalIssues: 2,
      errorCount: 1,
      duplicateCount: 1,
    })
    expect(result.filterOptions).toEqual({
      severities: ['High', 'Low'],
      owners: ['Revenue Ops', 'Tax Desk'],
      years: ['2025'],
      months: ['December'],
      quarters: ['Q4'],
    })
  })

  it('combines search, exact filters, period filters, date range, and pagination', () => {
    const documents = [
      createDocument({
        id: '1',
        status: 'Error',
        fileName: 'missing-tin.pdf',
        issueReason: 'Missing TIN',
        severity: 'High',
        owner: 'Revenue Ops',
        entity: 'AESI',
        year: '2025',
        month: 'December',
        quarter: 'Q4',
        updatedAt: 'May 01, 2026',
      }),
      createDocument({
        id: '2',
        status: 'Duplicate',
        fileName: 'duplicate.pdf',
        issueReason: 'Duplicate certificate',
        severity: 'Low',
        owner: 'Revenue Ops',
        entity: 'AESI',
        year: '2025',
        month: 'November',
        quarter: 'Q4',
        updatedAt: 'May 02, 2026',
      }),
      createDocument({
        id: '3',
        status: 'Error',
        fileName: 'late-missing-tin.pdf',
        issueReason: 'Missing TIN',
        severity: 'High',
        owner: 'Revenue Ops',
        entity: 'AESI',
        year: '2025',
        month: 'December',
        quarter: 'Q4',
        updatedAt: 'May 08, 2026',
      }),
    ]

    const result = buildIssueDocumentsListResult(documents, {
      ...defaultIssueInput,
      q: 'missing',
      severity: 'High',
      entity: 'AESI',
      year: '2025',
      month: 'December',
      quarter: 'Q4',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-08',
      page: 2,
      pageSize: 1,
    })

    expect(result.documents.map((document) => document.id)).toEqual(['3'])
    expect(result.pagination).toMatchObject({
      page: 2,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    })
    expect(result.summary).toEqual({
      totalIssues: 2,
      errorCount: 2,
      duplicateCount: 0,
    })
  })

  it('builds CSV exports with the expected headers, filename, and escaped values', () => {
    const documents = [
      createDocument({
        id: 'DOC-1',
        documentResultId: 101,
        uploadId: 'upload-1',
        uploadBatchId: 'batch-1',
        status: 'Error',
        fileName: 'missing, "tin".pdf',
        issueReason: 'Missing "TIN"',
        severity: 'High',
        owner: 'Revenue Ops',
        updatedAt: 'May 08, 2026',
        uploadedAt: 'May 01, 2026',
      }),
      createDocument({
        id: 'DOC-2',
        status: 'Duplicate',
        fileName: 'duplicate.pdf',
        issueReason: 'Duplicate certificate',
      }),
      createDocument({
        id: 'DOC-3',
        status: 'Error',
        fileName: 'unknown-fields.pdf',
        issueReason: 'Multiple certificates detected',
        atc: '—',
        taxBase: '—',
        taxWithheld: '—',
        confidence: '—',
      }),
    ]

    const result = buildIssueDocumentsExport(
      documents,
      {
        ...defaultIssueInput,
        status: 'error',
      },
      new Date('2026-05-18T02:00:00.000Z'),
    )
    const content = result.content.toString('utf8')

    expect(result.contentType).toBe('text/csv; charset=utf-8')
    expect(result.fileName).toBe('Issues-Queue-20260518-100000.csv')
    expect(result.rowCount).toBe(2)
    expect(content.split('\n')[0]).toBe(
      'File name,Issue type,Issue reason,Severity,Owner,Status,Stage,Next step,Entity,Payee,Payor,Period,Year,Month,Quarter,ATC,Tax base,Tax withheld,Confidence,Updated at,Uploaded at',
    )
    expect(content).toContain('"missing, ""tin"".pdf"')
    expect(content).toContain('"Missing ""TIN"""')
    expect(content).toContain('Validation failure')
    expect(content).toContain(
      'unknown-fields.pdf,Validation failure,Multiple certificates detected,low,Ada Admin,Error,Validated,Review or export,AESI,Payee,Customer,December 2025,2025,December,Q4,Unknown,Unknown,Unknown,Unknown,"May 8, 2026",',
    )
    expect(content).not.toContain('duplicate.pdf')
  })

  it('resolves multiple-certificate issue fields from the first normalized certificate page', () => {
    const normalized = getDocumentResultNormalizedPayload(
      {
        pages: [
          {
            pageNumber: 1,
            classification: 'non_certificate',
          },
          {
            pageNumber: 2,
            classification: 'certificate',
            normalized: {
              payeeName: 'First Certificate Payee',
              payorName: 'First Certificate Payor',
              periodCovered: '08-01-2025 to 08-31-2025',
              atcCode: 'WC160',
              taxBase: 1250,
              taxWithheld: 25,
            },
          },
          {
            pageNumber: 3,
            classification: 'certificate',
            normalized: {
              payeeName: 'Second Certificate Payee',
              payorName: 'Second Certificate Payor',
              atcCode: 'WC158',
            },
          },
        ],
        normalized: {
          payeeName: 'Fallback Payee',
          payorName: 'Fallback Payor',
        },
      },
      ['multiple_certificate_pages_detected'],
    )

    expect(normalized).toMatchObject({
      payeeName: 'First Certificate Payee',
      payorName: 'First Certificate Payor',
      periodCovered: '08-01-2025 to 08-31-2025',
      atcCode: 'WC160',
      taxBase: 1250,
      taxWithheld: 25,
    })
  })

  it('exports every row matching the same issue filters while ignoring pagination', () => {
    const documents = [
      createDocument({
        id: '1',
        status: 'Error',
        fileName: 'missing-tin.pdf',
        issueReason: 'Missing TIN',
        severity: 'High',
        owner: 'Revenue Ops',
      }),
      createDocument({
        id: '2',
        status: 'Error',
        fileName: 'missing-signature.pdf',
        issueReason: 'Missing Signature',
        severity: 'High',
        owner: 'Revenue Ops',
      }),
      createDocument({
        id: '3',
        status: 'Duplicate',
        fileName: 'missing-duplicate.pdf',
        issueReason: 'Duplicate certificate',
        severity: 'High',
        owner: 'Revenue Ops',
      }),
    ]
    const input: ListIssueDocumentsOptions = {
      ...defaultIssueInput,
      status: 'error',
      q: 'missing',
      severity: 'High',
      owner: 'Revenue Ops',
      page: 2,
      pageSize: 1,
    }

    const listed = buildIssueDocumentsListResult(documents, input)
    const exported = buildIssueDocumentsExport(documents, input)
    const content = exported.content.toString('utf8')

    expect(listed.documents.map((document) => document.id)).toEqual(['2'])
    expect(exported.rowCount).toBe(2)
    expect(content).toContain('missing-tin.pdf')
    expect(content).toContain('missing-signature.pdf')
    expect(content).not.toContain('missing-duplicate.pdf')
  })
})
