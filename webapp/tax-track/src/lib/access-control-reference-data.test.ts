import { describe, expect, it } from 'vitest'

import { canAccessPath } from '@/lib/access-control'

describe('reference data route access', () => {
  it('allows only the super admin', () => {
    expect(canAccessPath('/reference-data', 'super_admin')).toBe(true)
    expect(canAccessPath('/reference-data', 'admin')).toBe(false)
    expect(canAccessPath('/reference-data', 'editor')).toBe(false)
    expect(canAccessPath('/reference-data', 'viewer')).toBe(false)
  })
})
