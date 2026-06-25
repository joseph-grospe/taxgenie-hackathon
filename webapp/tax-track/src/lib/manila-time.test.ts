import { describe, expect, it } from 'vitest'

import { MANILA_TIME_ZONE, createManilaDateFormatter } from '@/lib/manila-time'

describe('manila-time', () => {
  it('enforces the Manila timezone on created formatters', () => {
    const formatter = createManilaDateFormatter('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
    })

    expect(formatter.resolvedOptions().timeZone).toBe(MANILA_TIME_ZONE)
  })

  it('formats UTC instants using Manila calendar parts', () => {
    const formatter = createManilaDateFormatter('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date('2026-04-23T16:05:00.000Z'))
        .map((part) => [part.type, part.value]),
    )

    expect(parts).toMatchObject({
      month: 'Apr',
      day: '24',
      year: '2026',
      hour: '12',
      minute: '05',
      dayPeriod: 'AM',
    })
  })
})
