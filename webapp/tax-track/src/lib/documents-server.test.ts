import { describe, expect, it } from 'vitest'

import type { OperationalDocumentView } from '@/lib/documents-types'
import type {
  ListIssueDocumentsOptions,
  ListValidatedDocumentsOptions,
} from '@/lib/documents-server'
import {
  applyNormalizedPatchToPayload,
  buildDocumentAtcCodes,
  buildDocumentErrors,
  buildDocumentTrail,
  buildDocumentTrailDetails,
  buildDuplicateErrors,
  buildIssueDocumentsExport,
  buildIssueDocumentsListResult,
  buildIssueFilterOptions,
  buildIssueReason,
  buildNextExtractedFieldsOverridePatch,
  buildNormalizedExtractedFieldsPatch,
  buildReconciliationTrailStep,
  buildSigningTrailStep,
  buildTemporaryProcessingFailurePresentation,
  buildValidatedDocumentsListResult,
  buildValidatedFilterOptions,
  formatDuplicateReasonMessage,
  getDocumentResultNormalizedPayload,
  getIssueYearFilterOptions,
  getLatestIssueEnvelopeRows,
  getManilaYearWindowFilterOptions,
  hasEditableCertificatePayload,
  toNormalizedCertificateProjection,
} from '@/lib/documents-server'

describe('certificate result projection', () => {
  it('keeps unique child ATCs in document order before the primary fallback', () => {
    expect(
      buildDocumentAtcCodes(
        [{ atcCode: 'WC157' }, { atcCode: 'WV020' }, { atcCode: 'WC157' }],
        'WV020',
      ),
    ).toEqual(['WC157', 'WV020'])
  })

  it('maps signer title and TIN to the canonical review field keys', () => {
    const projection = toNormalizedCertificateProjection({
      signerTitle: 'GENERAL MANAGER',
      signerTin: '168239148',
      signatureConfidence: '0.98',
      confidenceSummary: {
        period: 1,
        payee: 1,
        payor: 1,
        taxRows: 1,
        signer: 0.95,
      },
    } as unknown as Parameters<typeof toNormalizedCertificateProjection>[0])

    expect(projection).toMatchObject({
      signatoryTitle: 'GENERAL MANAGER',
      signatoryTin: '168239148',
      confidenceMap: {
        periodStart: 1,
        periodEnd: 1,
        monthOfQuarter: 1,
        payeeName: 1,
        payeeTin: 1,
        payorName: 1,
        payorTin: 1,
        atcCode: 1,
        taxBase: 1,
        taxWithheld: 1,
        printedName: 0.95,
        signatoryTitle: 0.95,
        signatoryTin: 0.95,
        companyName: 0.95,
        signaturePresent: 0.98,
      },
    })
    expect(projection).not.toHaveProperty('title')
    expect(projection).not.toHaveProperty('signerTin')
  })

  it('projects persisted primary ATC totals even for a variance error', () => {
    const projection = toNormalizedCertificateProjection({
      status: 'error',
      reasonCodes: ['variance_exceeded'],
      primaryAtcCode: 'WC160',
      totalTaxBase: '611504.51',
      totalTaxWithheld: '10919.72',
      signatureConfidence: '0.98',
      confidenceSummary: {},
    } as unknown as Parameters<typeof toNormalizedCertificateProjection>[0])

    expect(projection).toMatchObject({
      atcCode: 'WC160',
      taxBase: '611504.51',
      taxWithheld: '10919.72',
    })
  })
})

describe('latest document result issue selection', () => {
  it('does not retain a historical failure after a successful retry', () => {
    const rows = [
      {
        id: 43,
        uploadId: 'upload-success',
        status: 'accepted',
      },
      {
        id: 42,
        uploadId: 'upload-still-failed',
        status: 'error',
      },
      {
        id: 41,
        uploadId: 'upload-success',
        status: 'error',
      },
      {
        id: 40,
        uploadId: 'upload-still-failed',
        status: 'error',
      },
    ]

    expect(getLatestIssueEnvelopeRows(rows)).toEqual([rows[1]])
  })
})

describe('temporary document processing failure presentation', () => {
  const retryableFailure = {
    id: 38,
    currentExtractionAttemptId: 104,
    status: 'error',
    payload: null,
    certificateCount: 0,
    reasonCodes: ['gemini_http_503'],
    revision: 'etag-1',
    createdAt: new Date('2026-07-27T07:00:00.000Z'),
  }

  it('projects a retryable terminal failure as a completed processing error', () => {
    expect(
      buildTemporaryProcessingFailurePresentation(retryableFailure),
    ).toEqual({
      stage: 'Document processing failed',
      nextStep: 'Retry document processing',
      issueReason:
        'The document processing service was temporarily unavailable.',
      unavailableValue: 'Not available',
      validationChecksEmptyMessage:
        'Validation checks could not run because document processing did not finish.',
      error: {
        code: 'Document processing',
        stage: 'Temporarily unavailable',
        message:
          'We couldn’t process this document right now. Please try again in a few minutes.',
      },
    })
  })

  it('does not reclassify unrelated or mixed failures', () => {
    expect(
      buildTemporaryProcessingFailurePresentation({
        ...retryableFailure,
        reasonCodes: ['validation_failed'],
      }),
    ).toBeNull()
    expect(
      buildTemporaryProcessingFailurePresentation({
        ...retryableFailure,
        reasonCodes: ['gemini_http_503', 'validation_failed'],
      }),
    ).toBeNull()
  })
})

describe('independent identity validation errors', () => {
  it('preserves every failed payee and payor lookup for the error panel', () => {
    const checks = [
      {
        code: 'ENTITY_PAYEE_TIN_MATCH',
        passed: false,
        message: 'Payee TIN was not found for the selected entity.',
      },
      {
        code: 'ENTITY_PAYEE_NAME_MATCH',
        passed: false,
        message: 'Payee name was not found for the selected entity.',
      },
      {
        code: 'MASTERLIST_PAYOR_TIN_MATCH',
        passed: false,
        message: 'Payor TIN was not found in the masterlist.',
      },
      {
        code: 'MASTERLIST_PAYOR_NAME_MATCH',
        passed: false,
        message: 'Payor name was not found in the masterlist.',
      },
    ]

    expect(buildDocumentErrors('error', { checks }, [], [])).toEqual(
      checks.map((check) => ({
        code: check.code,
        stage: 'Validation',
        message: check.message,
      })),
    )
  })
})

describe('duplicate issue messages', () => {
  const reasonCases = [
    [
      'duplicate_source_document',
      'This exact file content was already uploaded before.',
    ],
    [
      'duplicate_uploaded_twice',
      'This exact file content was already uploaded before.',
    ],
    [
      'duplicate_certificate',
      'Certificate data matches a previously uploaded certificate.',
    ],
    [
      'duplicate_identical_data',
      'Certificate data matches a previously uploaded certificate.',
    ],
    [
      'duplicate_source_file_revision',
      'This source file revision has already been processed.',
    ],
  ] as const

  it.each(reasonCases)('formats %s', (reasonCode, expectedMessage) => {
    expect(formatDuplicateReasonMessage(reasonCode)).toBe(expectedMessage)
  })

  it('includes the current file name for legacy file-name matches', () => {
    expect(
      formatDuplicateReasonMessage(
        'duplicate_original_file_name',
        'repeated-certificate.pdf',
      ),
    ).toBe('File name matches a previous upload: repeated-certificate.pdf')
    expect(formatDuplicateReasonMessage('duplicate_original_file_name')).toBe(
      'File name matches a previous upload.',
    )
  })

  it('preserves multiple legacy duplicate reasons without repeated messages', () => {
    expect(
      buildDuplicateErrors(
        [
          'duplicate_source_file_revision',
          'duplicate_original_file_name',
          'duplicate_uploaded_twice',
          'duplicate_source_document',
          'duplicate_identical_data',
        ],
        'repeated-certificate.pdf',
      ).map((error) => error.message),
    ).toEqual([
      'This source file revision has already been processed.',
      'File name matches a previous upload: repeated-certificate.pdf',
      'This exact file content was already uploaded before.',
      'Certificate data matches a previously uploaded certificate.',
    ])
  })

  it('shows both current duplicate signals when both match', () => {
    expect(
      buildDuplicateErrors([
        'duplicate_source_document',
        'duplicate_certificate',
      ]).map((error) => error.message),
    ).toEqual([
      'This exact file content was already uploaded before.',
      'Certificate data matches a previously uploaded certificate.',
    ])
  })

  it('keeps unknown and missing duplicate reason fallbacks readable', () => {
    expect(
      buildDuplicateErrors(['unexpected_duplicate_reason']).map(
        (error) => error.message,
      ),
    ).toEqual(['Unexpected Duplicate Reason'])
    expect(buildDuplicateErrors([]).map((error) => error.message)).toEqual([
      'Document flagged as duplicate.',
    ])
  })

  it('flows the detailed duplicate message into issue reasons and exports', () => {
    const errors = buildDocumentErrors(
      'duplicate',
      {},
      ['duplicate_certificate'],
      [],
      'duplicate-message.pdf',
    )
    const issueReason = buildIssueReason({}, ['duplicate_certificate'], errors)
    const historicalIssueReason = buildIssueReason(
      { reasons: ['duplicate_identical_data'] },
      ['duplicate_identical_data'],
      errors,
    )
    const document = createDocument({
      id: 'duplicate-message',
      status: 'Duplicate',
      fileName: 'duplicate-message.pdf',
      issueReason,
      errorTypes: ['Duplicate'],
      errors,
    })
    const exported = buildIssueDocumentsExport([document], defaultIssueInput)

    expect(issueReason).toBe(
      'Certificate data matches a previously uploaded certificate.',
    )
    expect(historicalIssueReason).toBe(issueReason)
    expect(exported.content.toString('utf8')).toContain(
      'Certificate data matches a previously uploaded certificate.',
    )
  })
})

describe('multiple-certificate issue messages', () => {
  it.each([
    'multiple_certificates_detected',
    'multiple_certificate_pages_detected',
  ])('explains the selected-certificate behavior for %s', (reasonCode) => {
    const expected =
      'Multiple certificates were detected; only the earliest certificate was extracted for review.'

    expect(buildIssueReason({}, [reasonCode], [])).toBe(expected)
    expect(buildDocumentErrors('error', {}, [reasonCode], [])[0]?.message).toBe(
      expected,
    )
  })
})

describe('document lifecycle trail helpers', () => {
  it('keeps agentic workflow labels stable when certificate validation fails', () => {
    const createdAt = new Date('2026-04-29T15:44:00.000Z')
    const reasonCodes = [
      'missing_printed_name',
      'missing_signature',
      'payor_tin_not_found_in_masterlist',
    ]
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
      {
        stepName: 'process_certificates',
        status: 'error',
        metadata: {
          phase: 'validate',
          route: 'error',
          reasonCodes,
        },
        createdAt,
      },
      {
        stepName: 'finalize_workflow',
        status: 'error',
        metadata: {
          phase: 'persist',
          route: 'error',
          reasonCodes,
        },
        createdAt,
      },
    ] as Parameters<typeof buildDocumentTrail>[4]
    const issueReason =
      'Missing Printed Name; Missing Signature; Payor Tin Not Found In Masterlist'

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
      { label: 'Agent extraction', status: 'complete' },
      { label: 'Certificate validation', status: 'error' },
      { label: 'Persist results', status: 'pending' },
      { label: 'Reconciliation', status: 'pending' },
      { label: 'Signing', status: 'pending' },
    ])
    expect(
      details.find((detail) => detail.label === 'Certificate validation'),
    ).toMatchObject({
      status: 'error',
      description: issueReason,
    })
    expect(
      details.find((detail) => detail.label === 'Persist results'),
    ).toMatchObject({
      timestamp: '—',
      status: 'pending',
      description: 'Waiting for persist results.',
    })
  })

  it('formats uploaded timestamps in Manila time', () => {
    const uploadedAt = new Date('2026-06-28T02:10:00.000Z')
    const fileRecord = {
      uploadStatus: 'uploaded',
      queueStatus: 'pending',
      processingStatus: 'pending',
      errorMessage: null,
      uploadedAt,
      createdAt: uploadedAt,
      queuedAt: null,
      processingFinishedAt: null,
    } as Parameters<typeof buildDocumentTrail>[0]
    const issueReason = 'Document was uploaded and is waiting to be queued.'

    const trail = buildDocumentTrail(
      fileRecord,
      null,
      'Uploaded',
      issueReason,
      [],
    )
    const details = buildDocumentTrailDetails(
      fileRecord,
      null,
      trail,
      issueReason,
      [],
    )

    expect(details.find((detail) => detail.label === 'Uploaded')).toMatchObject(
      {
        timestamp: 'Jun 28, 2026, 10:10 AM',
      },
    )
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
        matchStatus: 'unmatched',
        hasDifference: true,
        createdAt: new Date('2026-04-28T10:00:00.000Z'),
      }),
    ).toEqual({
      label: 'Reconciliation',
      status: 'error',
      detail: 'Reconciliation variance remains open.',
    })

    expect(
      buildReconciliationTrailStep('Ready', {
        matchStatus: 'unmatched',
        hasDifference: false,
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
  certificateId: overrides.certificateId,
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
  atcCodes: overrides.atcCodes ?? [overrides.atc ?? 'WC160'],
  taxRows: overrides.taxRows ?? [],
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
  signingStatus: 'all',
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

const filterTestDate = new Date('2026-06-27T00:00:00.000Z')
const filterYears2026 = [
  '2021',
  '2022',
  '2023',
  '2024',
  '2025',
  '2026',
  '2027',
  '2028',
  '2029',
  '2030',
  '2031',
]
const filterMonths = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const validatedFilterErrorTypes = [
  'None',
  'Masterlist',
  'Missing TIN',
  'Missing Name',
  'Missing Period',
  'Missing Tax Data',
  'Missing Signature',
  'Missing Printed Name',
  'Variance',
  'Duplicate',
  'ATC',
  'Other',
]

describe('validated document listing', () => {
  it('builds canonical validated filter option domains', () => {
    expect(getManilaYearWindowFilterOptions(filterTestDate)).toEqual(
      filterYears2026,
    )

    expect(
      buildValidatedFilterOptions({
        atcCodes: ['WC160', 'WC158', 'WC160', ''],
        date: filterTestDate,
      }),
    ).toEqual({
      year: filterYears2026,
      month: filterMonths,
      quarter: ['Q1', 'Q2', 'Q3', 'Q4'],
      customerType: ['BIR 2307'],
      errorType: validatedFilterErrorTypes,
      atc: ['WC158', 'WC160'],
    })
  })

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

    const result = buildValidatedDocumentsListResult(
      documents,
      {
        ...defaultInput,
        entity: 'AESI',
        pageSize: 1,
      },
      buildValidatedFilterOptions({
        atcCodes: ['WC999', 'WC160'],
        date: filterTestDate,
      }),
    )

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
    expect(result.filterOptions).toEqual({
      year: filterYears2026,
      month: filterMonths,
      quarter: ['Q1', 'Q2', 'Q3', 'Q4'],
      customerType: ['BIR 2307'],
      errorType: validatedFilterErrorTypes,
      atc: ['WC160', 'WC999'],
    })
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

  it('filters signing status before paginating and updates summaries', () => {
    const documents = [
      createDocument({
        id: '1',
        taxWithheld: '1,000.00',
        signingStatus: 'signed',
      }),
      createDocument({
        id: '2',
        taxWithheld: '9,000.00',
        signingStatus: 'unsigned',
      }),
      createDocument({
        id: '3',
        taxWithheld: '8,000.00',
        signingStatus: 'failed',
      }),
      createDocument({
        id: '4',
        taxWithheld: '7,000.00',
        signingStatus: 'signed',
      }),
    ]

    const result = buildValidatedDocumentsListResult(
      documents,
      {
        ...defaultInput,
        signingStatus: 'signed',
        pageSize: 1,
      },
      buildValidatedFilterOptions({
        atcCodes: ['WC999'],
        date: filterTestDate,
      }),
    )

    expect(result.documents.map((document) => document.id)).toEqual(['4'])
    expect(result.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    })
    expect(result.summary).toEqual({
      totalValidated: 2,
      certificateCount: 2,
      signedPdfCount: 2,
    })
    expect(result.filterOptions.atc).toEqual(['WC999'])
    expect(result.filterOptions.year).toEqual(filterYears2026)
  })

  it('keeps failed signing attempts separate from unsigned validated documents', () => {
    const documents = [
      createDocument({
        id: '1',
        signingStatus: 'unsigned',
      }),
      createDocument({
        id: '2',
        signingStatus: 'failed',
      }),
    ]

    const result = buildValidatedDocumentsListResult(documents, {
      ...defaultInput,
      signingStatus: 'unsigned',
    })

    expect(result.documents.map((document) => document.id)).toEqual(['1'])
    expect(result.summary).toEqual({
      totalValidated: 1,
      certificateCount: 1,
      signedPdfCount: 0,
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
  it('preserves aggregated validation errors and checks in issue rows', () => {
    const documents = [
      createDocument({
        id: 'aggregate-error',
        status: 'Error',
        issueReason:
          'Unknown Atc Code; Entity Payee Tin Mismatch; Payor Tin Not Found In Masterlist',
        errors: [
          {
            code: 'ATC_RATE_NOT_FOUND',
            stage: 'Validation',
            message: 'ATC rate not configured: WC999',
          },
          {
            code: 'ENTITY_PAYEE_TIN_MATCH',
            stage: 'Validation',
            message:
              'Selected entity TIN/company name does not match payee TIN/name',
          },
          {
            code: 'MASTERLIST_PAYOR_TIN_MATCH',
            stage: 'Validation',
            message:
              'Payor TIN prefix "007833205" was not found in the masterlist',
          },
        ],
        validationChecks: [
          {
            code: 'ATC_RATE_NOT_FOUND',
            passed: false,
            message: 'ATC rate not configured: WC999',
          },
          {
            code: 'ENTITY_PAYEE_TIN_MATCH',
            passed: false,
            message:
              'Selected entity TIN/company name does not match payee TIN/name',
          },
          {
            code: 'MASTERLIST_PAYOR_TIN_MATCH',
            passed: false,
            message:
              'Payor TIN prefix "007833205" was not found in the masterlist',
          },
        ],
      }),
    ]

    const result = buildIssueDocumentsListResult(documents, defaultIssueInput)

    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]?.issueReason).toBe(
      'Unknown Atc Code; Entity Payee Tin Mismatch; Payor Tin Not Found In Masterlist',
    )
    expect(result.documents[0]?.errors.map((error) => error.code)).toEqual([
      'ATC_RATE_NOT_FOUND',
      'ENTITY_PAYEE_TIN_MATCH',
      'MASTERLIST_PAYOR_TIN_MATCH',
    ])
    expect(
      result.documents[0]?.validationChecks.map((check) => check.code),
    ).toEqual([
      'ATC_RATE_NOT_FOUND',
      'ENTITY_PAYEE_TIN_MATCH',
      'MASTERLIST_PAYOR_TIN_MATCH',
    ])
  })

  it('builds canonical issue filter option domains', () => {
    expect(getIssueYearFilterOptions(filterTestDate)).toEqual(filterYears2026)

    expect(
      buildIssueFilterOptions({
        owners: ['Tax Desk', 'Accounts Ops', 'Tax Desk'],
        date: filterTestDate,
      }),
    ).toEqual({
      severities: ['High', 'Medium', 'Low'],
      owners: ['Accounts Ops', 'Tax Desk'],
      years: filterYears2026,
      months: filterMonths,
      quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
    })
  })

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

    const result = buildIssueDocumentsListResult(
      documents,
      {
        ...defaultIssueInput,
        status: 'duplicate',
        owner: 'Revenue Ops',
      },
      buildIssueFilterOptions({
        owners: ['Tax Desk', 'Accounts Ops'],
        date: filterTestDate,
      }),
    )

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
      severities: ['High', 'Medium', 'Low'],
      owners: ['Accounts Ops', 'Tax Desk'],
      years: filterYears2026,
      months: filterMonths,
      quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
    })
  })

  it('counts validation-error documents as errors', () => {
    const documents = [
      createDocument({ id: '1', status: 'Error' }),
      createDocument({ id: '2', status: 'Error' }),
      createDocument({ id: '3', status: 'Duplicate' }),
    ]

    const result = buildIssueDocumentsListResult(documents, {
      ...defaultIssueInput,
      status: 'error',
    })

    expect(result.documents.map((document) => document.id)).toEqual(['1', '2'])
    expect(result.summary).toEqual({
      totalIssues: 3,
      errorCount: 2,
      duplicateCount: 1,
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

  it('finds issue documents by a secondary child ATC', () => {
    const result = buildIssueDocumentsListResult(
      [
        createDocument({
          id: '1',
          status: 'Error',
          atc: 'WC157, WV020',
          atcCodes: ['WC157', 'WV020'],
        }),
        createDocument({
          id: '2',
          status: 'Error',
          atc: 'WC160',
          atcCodes: ['WC160'],
        }),
      ],
      { ...defaultIssueInput, q: 'WV020' },
    )

    expect(result.documents.map((document) => document.id)).toEqual(['1'])
  })

  it('builds CSV exports with the expected headers, filename, and escaped values', () => {
    const documents = [
      createDocument({
        id: 'DOC-1',
        certificateId: 101,
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
