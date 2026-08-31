import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  featureDisabledResponse,
  isFeatureEnabled,
  requireFeature,
} from '@/lib/feature-flags-server'

describe('production feature boundary', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('defaults deferred production features to disabled', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TAXGENIE_ENABLE_MERGE', '')
    expect(isFeatureEnabled('merge')).toBe(false)
    expect(() => requireFeature('merge')).toThrow(/disabled/)
  })

  it('returns the stable feature_disabled response', async () => {
    const response = featureDisabledResponse('purge')
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'feature_disabled' })
  })
})
