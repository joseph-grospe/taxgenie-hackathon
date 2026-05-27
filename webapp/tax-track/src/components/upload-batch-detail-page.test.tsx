import { describe, expect, it } from 'vitest'

import { canExportBatchBir2307 } from '@/components/upload-batch-detail-page'

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
