import { afterEach, describe, expect, it, vi } from 'vitest'

import { sendReconciliationEmail } from '@/lib/reconciliation-email-server'

describe('reconciliation email production boundary', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('rejects direct sends before database or provider work when disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TAXGENIE_ENABLE_OUTBOUND_EMAIL', 'false')

    await expect(sendReconciliationEmail(1)).rejects.toMatchObject({
      status: 503,
      code: 'feature_disabled',
    })
  })
})
