import { describe, expect, it } from 'vitest'

import { calculateDaysUncollected } from '@/lib/reconciliation-aging'

describe('reconciliation aging', () => {
  it('starts counting after the 30-day grace period from email sent date', () => {
    expect(
      calculateDaysUncollected({
        emailSentAt: '2026-05-06T01:00:00.000Z',
        matchedAt: '2026-06-10T01:00:00.000Z',
      }),
    ).toBe(5)
  })

  it('uses today for emailed rows that are still unmatched', () => {
    expect(
      calculateDaysUncollected(
        {
          emailSentAt: '2026-05-06T01:00:00.000Z',
          matchedAt: null,
        },
        {
          now: new Date('2026-06-07T01:00:00.000Z'),
        },
      ),
    ).toBe(2)
  })

  it('does not count rows before outreach starts', () => {
    expect(
      calculateDaysUncollected({
        emailSentAt: null,
        matchedAt: '2026-06-10T01:00:00.000Z',
      }),
    ).toBeNull()
  })
})
