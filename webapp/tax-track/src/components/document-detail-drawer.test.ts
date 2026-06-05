import { describe, expect, it } from 'vitest'

import type { DocumentReviewFieldView } from '@/lib/documents-types'
import { getDrawerReviewFields } from '@/components/document-detail-drawer'

const field = (
  overrides: Partial<DocumentReviewFieldView>,
): DocumentReviewFieldView => ({
  key: overrides.key,
  label: overrides.label ?? 'Payee name',
  value: overrides.value ?? 'Payee Corp',
  confidence: overrides.confidence ?? '95%',
  source: overrides.source ?? 'original',
})

describe('document detail drawer extracted fields', () => {
  it('keeps extracted fields while excluding signature text only', () => {
    const visibleFields = getDrawerReviewFields([
      field({ key: 'payeeName', label: 'Payee name' }),
      field({
        key: 'signatureText',
        label: 'Signature text',
        value: 'Signed by Ada',
      }),
      field({
        key: 'signaturePresent',
        label: 'Signature present',
        value: 'Yes',
      }),
      field({
        label: 'Signature Text',
        value: 'Legacy signature value',
      }),
    ])

    expect(visibleFields.map((item) => item.label)).toEqual([
      'Payee name',
      'Signature present',
    ])
  })
})
