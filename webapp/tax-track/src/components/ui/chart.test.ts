import { describe, expect, it } from 'vitest'

import { hasChartTooltipValue } from '@/components/ui/chart'

describe('hasChartTooltipValue', () => {
  it('keeps zero values visible in chart tooltips', () => {
    expect(hasChartTooltipValue(0)).toBe(true)
    expect(hasChartTooltipValue('')).toBe(true)
    expect(hasChartTooltipValue(undefined)).toBe(false)
    expect(hasChartTooltipValue(null)).toBe(false)
  })
})
