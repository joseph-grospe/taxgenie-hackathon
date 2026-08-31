import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildVerificationEmailHtml,
  buildVerificationEmailText,
  resolveAuthEmailRecipients,
  sendAuthVerificationEmail,
} from '@/lib/auth-email-server'

describe('auth-email-server', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the exact account email', () => {
    expect(resolveAuthEmailRecipients(' real-user@example.com ')).toEqual([
      'real-user@example.com',
    ])
  })

  it('builds verification bodies without including a password', () => {
    const input = {
      user: { email: 'new.user@example.com', name: 'New <User>' },
      url: 'https://taxgenie.example.com/api/auth/verify-email?token=abc',
      token: 'abc',
    }
    const text = buildVerificationEmailText(input)
    const html = buildVerificationEmailHtml(input)

    expect(text).toContain('finish setting up your account')
    expect(text.toLowerCase()).not.toContain('temporary password')
    expect(html).toContain('New &lt;User&gt;')
    expect(html.toLowerCase()).not.toContain('temporary password')
  })

  it('rejects verification email requests when outbound email is disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TAXGENIE_ENABLE_OUTBOUND_EMAIL', 'false')

    await expect(
      sendAuthVerificationEmail({
        user: { email: 'new.user@example.com', name: 'New User' },
        url: 'https://taxgenie.example.com/verify',
        token: 'abc',
      }),
    ).rejects.toMatchObject({ status: 503, code: 'feature_disabled' })
  })
})
