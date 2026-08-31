import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildUserStatusNotificationHtml,
  buildUserStatusNotificationText,
  getUserStatusNotificationSubject,
  resolveUserStatusNotificationRecipients,
  sendUserStatusNotificationEmail,
} from '@/lib/user-status-email-server'

describe('user-status-email-server', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the exact affected user email', () => {
    expect(
      resolveUserStatusNotificationRecipients(' user@example.com '),
    ).toEqual(['user@example.com'])
  })

  it('builds escaped deactivation and reactivation bodies', () => {
    const deactivated = {
      status: 'deactivated' as const,
      user: { email: 'user@example.com', name: 'New <User>' },
    }
    expect(getUserStatusNotificationSubject('deactivated')).toContain(
      'deactivated',
    )
    expect(buildUserStatusNotificationText(deactivated)).toContain(
      'can no longer sign in',
    )
    expect(buildUserStatusNotificationHtml(deactivated)).toContain(
      'New &lt;User&gt;',
    )

    const reactivated = { ...deactivated, status: 'reactivated' as const }
    expect(buildUserStatusNotificationText(reactivated)).toContain(
      'sign-in access has been restored',
    )
  })

  it('rejects notifications when outbound email is disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TAXGENIE_ENABLE_OUTBOUND_EMAIL', 'false')

    await expect(
      sendUserStatusNotificationEmail({
        status: 'reactivated',
        user: { email: 'user@example.com', name: 'New User' },
      }),
    ).rejects.toMatchObject({ status: 503, code: 'feature_disabled' })
  })
})
