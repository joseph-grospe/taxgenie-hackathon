import { describe, expect, it } from 'vitest'

import {
  formatTinForDisplay,
  normalizeTinDigits,
} from '@taxtrack/shared/utils/tin'

describe('TIN helpers', () => {
  it('normalizes TIN values to digits only', () => {
    expect(normalizeTinDigits('267x090x070x0000')).toBe('2670900700000')
    expect(normalizeTinDigits('2,6,7-0,9,0-0,7,0-0,0,0')).toBe('267090070000')
    expect(normalizeTinDigits('006-922-063-000')).toBe('006922063000')
    expect(normalizeTinDigits('266-566-116-00000')).toBe('26656611600000')
    expect(normalizeTinDigits('123-45')).toBe('12345')
    expect(normalizeTinDigits(2670900700000)).toBe('2670900700000')
  })

  it('returns null for values without usable digits', () => {
    expect(normalizeTinDigits('---')).toBeNull()
    expect(normalizeTinDigits('TIN')).toBeNull()
    expect(normalizeTinDigits('')).toBeNull()
    expect(normalizeTinDigits('   ')).toBeNull()
    expect(normalizeTinDigits(null)).toBeNull()
    expect(normalizeTinDigits(undefined)).toBeNull()
    expect(normalizeTinDigits({ tin: '123' })).toBeNull()
    expect(normalizeTinDigits(['123'])).toBeNull()
  })

  it('formats TIN values for display using 3-3-3-rest grouping', () => {
    expect(formatTinForDisplay('267090070')).toBe('267-090-070')
    expect(formatTinForDisplay('267090070000')).toBe('267-090-070-000')
    expect(formatTinForDisplay('2670900700000')).toBe('267-090-070-0000')
    expect(formatTinForDisplay('26656611600000')).toBe('266-566-116-00000')
    expect(formatTinForDisplay('333444')).toBe('333-444')
    expect(formatTinForDisplay('TIN')).toBe('')
  })
})
