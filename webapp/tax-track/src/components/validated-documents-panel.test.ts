import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { OperationalDocumentView } from '@/lib/documents-types'
import {
  getExtractedFieldsEditState,
  getExtractedFieldsInitialValues,
  getGroupedExtractedFieldSections,
  getValidatedDocumentActionState,
  toEditableReviewFields,
} from '@/components/validated-documents-panel'

type EditableReviewField = OperationalDocumentView['reviewFields'][number] & {
  key: string
}

const createDocument = (
  overrides: Partial<OperationalDocumentView> = {},
): OperationalDocumentView => ({
  id: overrides.id ?? '42',
  documentResultId: overrides.documentResultId ?? 42,
  kind: overrides.kind ?? 'certificate',
  uploadId: overrides.uploadId ?? 'upload-42',
  uploadBatchId: overrides.uploadBatchId ?? 'batch-42',
  fileName: overrides.fileName ?? 'validated.pdf',
  status: overrides.status ?? 'Ready',
  stage: overrides.stage ?? 'Validated',
  nextStep: overrides.nextStep ?? 'Review or export',
  payee: overrides.payee ?? 'Payee Corp',
  payorName: overrides.payorName ?? 'Original Customer',
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
  severity: overrides.severity ?? 'Low',
  owner: overrides.owner ?? 'Tax Desk',
  updatedAt: overrides.updatedAt ?? 'Jun 05, 2026, 10:00 AM',
  trail: overrides.trail ?? [],
  logs: overrides.logs ?? [],
  errors: overrides.errors ?? [],
  validationChecks: overrides.validationChecks ?? [],
  reviewFields: overrides.reviewFields ?? [],
  canSign: overrides.canSign ?? true,
  signingStatus: overrides.signingStatus ?? 'unsigned',
  signedPdfUrl: overrides.signedPdfUrl,
  hasSavedTemplatePlacement: overrides.hasSavedTemplatePlacement ?? false,
})

describe('validated document action state', () => {
  it('shows sign and edit for unsigned editable certificates', () => {
    expect(
      getValidatedDocumentActionState({
        document: createDocument(),
        canAccessSigning: true,
        canDownloadSignedPdf: true,
        canEditExtractedFields: true,
      }),
    ).toEqual({
      showView: true,
      showSign: true,
      showDownload: false,
      showEdit: true,
      editDisabledReason: '',
      hasActions: true,
    })
  })

  it('shows download and disables edit for signed certificates', () => {
    expect(
      getValidatedDocumentActionState({
        document: createDocument({
          canSign: false,
          signingStatus: 'signed',
          signedPdfUrl: '/api/s3-object?key=signed.pdf',
        }),
        canAccessSigning: true,
        canDownloadSignedPdf: true,
        canEditExtractedFields: true,
      }),
    ).toEqual({
      showView: true,
      showSign: false,
      showDownload: true,
      showEdit: true,
      editDisabledReason: 'Signed certificates cannot be edited.',
      hasActions: true,
    })
  })

  it('hides edit for viewers without field edit permission', () => {
    expect(
      getValidatedDocumentActionState({
        document: createDocument(),
        canAccessSigning: true,
        canDownloadSignedPdf: true,
        canEditExtractedFields: false,
      }),
    ).toMatchObject({
      showView: true,
      showEdit: false,
      hasActions: true,
    })
  })

  it('keeps view available when no workflow actions apply', () => {
    expect(
      getValidatedDocumentActionState({
        document: createDocument({
          canSign: false,
          uploadBatchId: undefined,
          kind: 'upload',
        }),
        canAccessSigning: false,
        canDownloadSignedPdf: false,
        canEditExtractedFields: false,
      }),
    ).toMatchObject({
      showView: true,
      showSign: false,
      showDownload: false,
      showEdit: false,
      hasActions: true,
    })
  })
})

describe('extracted field edit sheet helpers', () => {
  const createField = (
    overrides: Partial<EditableReviewField> & Pick<EditableReviewField, 'key'>,
  ): EditableReviewField => ({
    key: overrides.key,
    label: overrides.label ?? overrides.key,
    rawValue: overrides.rawValue ?? '',
    value: overrides.value ?? String(overrides.rawValue ?? ''),
    confidence: overrides.confidence ?? '—',
    source: overrides.source ?? 'original',
    originalValue: overrides.originalValue,
    editedAt: overrides.editedAt,
    editedByName: overrides.editedByName,
  })

  it('tracks saved edited fields and unsaved changes separately', () => {
    const fields = [
      createField({ key: 'payeeName', rawValue: 'Payee Corp' }),
      createField({
        key: 'taxWithheld',
        rawValue: 200,
        value: '200.00',
        source: 'edited',
        originalValue: '100.00',
      }),
    ]
    const initialValues = getExtractedFieldsInitialValues(fields)

    const state = getExtractedFieldsEditState({
      fields,
      initialValues,
      values: {
        ...initialValues,
        payeeName: 'Updated Payee Corp',
      },
    })

    expect(state.changedFields).toEqual({
      payeeName: 'Updated Payee Corp',
    })
    expect(state.changedCount).toBe(1)
    expect(state.editedCount).toBe(1)
    expect(state.reviewFieldCount).toBe(2)
  })

  it('groups correction fields and keeps dirty fields visible in edited filter', () => {
    const fields = [
      createField({ key: 'periodStart', rawValue: '2025-08-01' }),
      createField({ key: 'payeeName', rawValue: 'Payee Corp' }),
      createField({
        key: 'taxBase',
        rawValue: 10000,
        value: '10,000.00',
        source: 'edited',
        originalValue: '9,000.00',
      }),
      createField({
        key: 'companyName',
        label: 'Signatory company name',
        rawValue: 'Signatory Corp',
      }),
    ]

    expect(
      getGroupedExtractedFieldSections({
        fields,
        filter: 'all',
        changedFieldKeys: new Set(),
      }).map((section) => ({
        label: section.label,
        keys: section.fields.map((field) => field.key),
      })),
    ).toEqual([
      { label: 'Certificate', keys: ['periodStart'] },
      { label: 'Parties', keys: ['payeeName'] },
      { label: 'Amounts', keys: ['taxBase'] },
      { label: 'Signatory', keys: ['companyName'] },
    ])

    expect(
      getGroupedExtractedFieldSections({
        fields,
        filter: 'edited',
        changedFieldKeys: new Set(['payeeName']),
      }).map((section) => ({
        label: section.label,
        keys: section.fields.map((field) => field.key),
      })),
    ).toEqual([
      { label: 'Parties', keys: ['payeeName'] },
      { label: 'Amounts', keys: ['taxBase'] },
    ])
  })

  it('uses period start as the editable alias for period covered', () => {
    const fields = toEditableReviewFields(
      createDocument({
        reviewFields: [
          createField({
            key: 'periodCovered',
            label: 'Period covered',
            rawValue: '08-01-2025 to 08-31-2025',
            value: '08-01-2025 to 08-31-2025',
            source: 'edited',
            originalValue: '07-01-2025 to 07-31-2025',
          }),
          createField({
            key: 'periodEnd',
            label: 'Period end',
            rawValue: '08-31-2025',
            value: '08-31-2025',
          }),
        ],
      }),
    )

    expect(fields.map((field) => [field.key, field.label])).toEqual([
      ['periodStart', 'Period start'],
      ['periodEnd', 'Period end'],
    ])
    expect(getExtractedFieldsInitialValues(fields)).toEqual({
      periodStart: '2025-08-01',
      periodEnd: '2025-08-31',
    })
    expect(fields[0].originalValue).toBe('2025-07-01')
    expect(fields[0].source).toBe('edited')
  })

  it('uses a real normalized period start field when available', () => {
    const fields = toEditableReviewFields(
      createDocument({
        reviewFields: [
          createField({
            key: 'periodStart',
            label: 'Period start',
            rawValue: '08-05-2025',
            value: '08-05-2025',
          }),
          createField({
            key: 'periodEnd',
            label: 'Period end',
            rawValue: '08-31-2025',
            value: '08-31-2025',
          }),
        ],
      }),
    )

    expect(getExtractedFieldsInitialValues(fields)).toEqual({
      periodStart: '2025-08-05',
      periodEnd: '2025-08-31',
    })
  })

  it('captures input event values before state updater callbacks', () => {
    const source = readFileSync(
      new URL('./validated-documents-panel.tsx', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain('[field.key]: event.currentTarget.value')
    expect(source).toContain('const value = event.currentTarget.value')
  })

  it('does not reinitialize the edit draft during same-document refreshes', () => {
    const source = readFileSync(
      new URL('./validated-documents-panel.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain(
      'const initializedDocumentIdRef = useRef<string | null>(null)',
    )
    expect(source).toContain(
      'if (initializedDocumentIdRef.current === documentId)',
    )
    expect(source).toContain('initializedDocumentIdRef.current = documentId')
    expect(source).not.toContain('}, [document, initialValues, open])')
  })
})
