import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'

import type { OperationalDocumentView } from '@/lib/documents-types'
import type { ListIssueDocumentsOptions } from '@/lib/documents-server'
import type { IssueOriginalFileSource } from '@/lib/issue-files-server'
import {
  ISSUE_FILE_DOWNLOAD_MAX_FILES,
  buildIssueFileDownloadPlan,
  buildIssueFileZipDownload,
  toIssueFileDownloadLimitMessage,
} from '@/lib/issue-files-server'

const defaultIssueInput: ListIssueDocumentsOptions = {
  status: 'all',
  q: '',
  severity: '',
  owner: '',
  entity: '',
  entityId: '',
  year: '',
  month: '',
  quarter: '',
  dateFrom: '',
  dateTo: '',
  page: 1,
  pageSize: 25,
}

const createIssueDocument = (
  overrides: Partial<OperationalDocumentView> = {},
): OperationalDocumentView => ({
  id: overrides.id ?? 'issue-1',
  certificateId: overrides.certificateId,
  kind: overrides.kind ?? 'upload',
  uploadId: overrides.uploadId ?? 'upload-1',
  uploadBatchId: overrides.uploadBatchId ?? 'batch-1',
  removedFromBatchAt: overrides.removedFromBatchAt,
  fileName: overrides.fileName ?? 'issue.pdf',
  uploadedAt: overrides.uploadedAt ?? 'May 1, 2026',
  sizeBytes: overrides.sizeBytes ?? 1024,
  status: overrides.status ?? 'Error',
  stage: overrides.stage ?? 'Validated',
  nextStep: overrides.nextStep ?? 'Review or export',
  payee: overrides.payee ?? 'Payee',
  payorName: overrides.payorName ?? 'Customer',
  period: overrides.period ?? 'December 2025',
  atc: overrides.atc ?? 'WC160',
  atcCodes: overrides.atcCodes ?? [overrides.atc ?? 'WC160'],
  taxRows: overrides.taxRows ?? [],
  taxBase: overrides.taxBase ?? '1,000.00',
  taxWithheld: overrides.taxWithheld ?? '20.00',
  confidence: overrides.confidence ?? '92%',
  year: overrides.year ?? '2025',
  month: overrides.month ?? 'December',
  quarter: overrides.quarter ?? 'Q4',
  entity: overrides.entity ?? 'AESI',
  customerType: overrides.customerType ?? 'BIR 2307',
  errorTypes: overrides.errorTypes ?? ['Validation'],
  issueReason: overrides.issueReason ?? 'Missing TIN',
  severity: overrides.severity ?? 'High',
  owner: overrides.owner ?? 'Revenue Ops',
  updatedAt: overrides.updatedAt ?? 'May 8, 2026',
  processing: overrides.processing,
  trail: overrides.trail ?? [],
  trailDetails: overrides.trailDetails,
  logs: overrides.logs ?? [],
  errors: overrides.errors ?? [],
  validationChecks: overrides.validationChecks ?? [],
  reviewFields: overrides.reviewFields ?? [],
  extractedFieldsEdit: overrides.extractedFieldsEdit,
  canEditExtractedFields: overrides.canEditExtractedFields,
  canSign: overrides.canSign ?? false,
  signingStatus: overrides.signingStatus ?? 'unsigned',
  signedAt: overrides.signedAt,
  signedByName: overrides.signedByName,
  signedPdfUrl: overrides.signedPdfUrl,
  hasSavedTemplatePlacement: overrides.hasSavedTemplatePlacement ?? false,
  mergeAssignments: overrides.mergeAssignments,
  override: overrides.override,
  canRequestOverride: overrides.canRequestOverride,
})

const createFileSource = (
  overrides: Partial<IssueOriginalFileSource> = {},
): IssueOriginalFileSource => ({
  id: overrides.id ?? 'upload-1',
  originalFileName: overrides.originalFileName ?? 'issue.pdf',
  storageBucket: overrides.storageBucket ?? 'storage',
  storageKey: overrides.storageKey ?? 'uploads/issue.pdf',
  sizeBytes: overrides.sizeBytes ?? 1024,
})

describe('issue original file downloads', () => {
  it('applies issue filters while ignoring pagination', () => {
    const documents = [
      createIssueDocument({
        id: 'issue-1',
        uploadId: 'upload-1',
        fileName: 'missing-tin.pdf',
        issueReason: 'Missing TIN',
      }),
      createIssueDocument({
        id: 'issue-2',
        uploadId: 'upload-2',
        fileName: 'missing-signature.pdf',
        issueReason: 'Missing signature',
      }),
      createIssueDocument({
        id: 'issue-3',
        uploadId: 'upload-3',
        status: 'Duplicate',
        fileName: 'missing-duplicate.pdf',
        issueReason: 'Duplicate certificate',
      }),
    ]
    const files = documents.map((document) =>
      createFileSource({
        id: document.uploadId,
        originalFileName: document.fileName,
        storageKey: `uploads/${document.fileName}`,
      }),
    )

    const plan = buildIssueFileDownloadPlan(documents, files, {
      ...defaultIssueInput,
      status: 'error',
      q: 'missing',
      severity: 'High',
      page: 2,
      pageSize: 1,
    })

    expect(plan.entries.map((entry) => entry.uploadId)).toEqual([
      'upload-1',
      'upload-2',
    ])
    expect(plan.fileCount).toBe(2)
  })

  it('blocks filtered downloads beyond the file cap', () => {
    const documents = Array.from(
      { length: ISSUE_FILE_DOWNLOAD_MAX_FILES + 1 },
      (_, index) =>
        createIssueDocument({
          id: `issue-${index}`,
          uploadId: `upload-${index}`,
          fileName: `issue-${index}.pdf`,
        }),
    )
    const files = documents.map((document) =>
      createFileSource({
        id: document.uploadId,
        originalFileName: document.fileName,
      }),
    )

    expect(() =>
      buildIssueFileDownloadPlan(documents, files, defaultIssueInput),
    ).toThrow(toIssueFileDownloadLimitMessage(ISSUE_FILE_DOWNLOAD_MAX_FILES))
  })

  it('blocks filtered downloads beyond the source size cap', () => {
    const documents = [
      createIssueDocument({
        id: 'issue-1',
        uploadId: 'upload-1',
      }),
    ]
    const files = [
      createFileSource({
        id: 'upload-1',
        sizeBytes: 200 * 1024 * 1024 + 1,
      }),
    ]

    expect(() =>
      buildIssueFileDownloadPlan(documents, files, defaultIssueInput),
    ).toThrow('Download is limited to 200 MiB.')
  })

  it('sanitizes duplicate filenames and builds a zip archive', async () => {
    const documents = [
      createIssueDocument({
        id: 'issue-1',
        uploadId: 'upload-1',
        fileName: '../Final?.pdf',
      }),
      createIssueDocument({
        id: 'issue-2',
        uploadId: 'upload-2',
        fileName: '../Final?.pdf',
      }),
    ]
    const files = documents.map((document) =>
      createFileSource({
        id: document.uploadId,
        originalFileName: document.fileName,
        storageKey: `uploads/${document.uploadId}.pdf`,
      }),
    )

    const download = await buildIssueFileZipDownload(
      documents,
      files,
      defaultIssueInput,
      {
        date: new Date('2026-05-18T02:00:00.000Z'),
        readObjectBytes: ({ key }) =>
          Promise.resolve(new TextEncoder().encode(`bytes:${key}`)),
      },
    )
    const entries = unzipSync(download.bytes)

    expect(download.fileName).toBe('Issue-Files-20260518-100000.zip')
    expect(Object.keys(entries).sort()).toEqual([
      'Final_ (2).pdf',
      'Final_.pdf',
    ])
    expect(new TextDecoder().decode(entries['Final_.pdf'])).toBe(
      'bytes:uploads/upload-1.pdf',
    )
    expect(new TextDecoder().decode(entries['Final_ (2).pdf'])).toBe(
      'bytes:uploads/upload-2.pdf',
    )
  })
})
