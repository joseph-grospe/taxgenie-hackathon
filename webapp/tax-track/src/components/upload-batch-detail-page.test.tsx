import { describe, expect, it } from 'vitest'

import {
  canDeleteUploadBatch,
  canExportBatchBir2307,
} from '@/components/upload-batch-detail-page'

describe('canExportBatchBir2307', () => {
  it('allows export for closed batches when sheet export is allowed', () => {
    expect(canExportBatchBir2307({ status: 'closed' }, true)).toBe(true)
  })

  it('blocks export when sheet export is not allowed', () => {
    expect(canExportBatchBir2307({ status: 'closed' }, false)).toBe(false)
  })

  it('blocks export while the batch is open', () => {
    expect(canExportBatchBir2307({ status: 'open' }, true)).toBe(false)
  })

  it('blocks export while the batch has not loaded', () => {
    expect(canExportBatchBir2307(null, true)).toBe(false)
  })
})

describe('canDeleteUploadBatch', () => {
  it('allows delete for closed active batches when batch management is allowed', () => {
    expect(
      canDeleteUploadBatch({ status: 'closed', deletedAt: null }, true),
    ).toBe(true)
  })

  it('blocks delete for open batches', () => {
    expect(
      canDeleteUploadBatch({ status: 'open', deletedAt: null }, true),
    ).toBe(false)
  })

  it('blocks delete without batch management access', () => {
    expect(
      canDeleteUploadBatch({ status: 'closed', deletedAt: null }, false),
    ).toBe(false)
  })

  it('blocks delete for batches already in Recently Deleted', () => {
    expect(
      canDeleteUploadBatch(
        { status: 'closed', deletedAt: '2026-04-20T10:00:00.000Z' },
        true,
      ),
    ).toBe(false)
  })
})
