import { describe, expect, it } from 'vitest'

import { shouldShowSalesReportVersionStatus } from '@/routes/reconciliation.reports.$reportId'

describe('shouldShowSalesReportVersionStatus', () => {
  it('hides the version status when it duplicates the report status label', () => {
    expect(shouldShowSalesReportVersionStatus('ready', 'ready')).toBe(false)
    expect(shouldShowSalesReportVersionStatus('error', 'error')).toBe(false)
  })

  it('shows the version status when it adds different state', () => {
    expect(shouldShowSalesReportVersionStatus('uploading', 'pending')).toBe(
      true,
    )
    expect(shouldShowSalesReportVersionStatus('ready', 'error')).toBe(true)
  })

  it('hides the version status when there is no current version', () => {
    expect(shouldShowSalesReportVersionStatus('ready', null)).toBe(false)
    expect(shouldShowSalesReportVersionStatus('ready', undefined)).toBe(false)
  })
})
