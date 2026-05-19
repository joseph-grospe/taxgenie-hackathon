import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSesServerClient: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@aws-sdk/client-ses', () => ({
  SendEmailCommand: class SendEmailCommand {
    input: unknown

    constructor(input: unknown) {
      this.input = input
    }
  },
}))

vi.mock('@/lib/aws-server', () => ({
  createSesServerClient: mocks.createSesServerClient,
}))

const {
  buildUserStatusNotificationHtml,
  buildUserStatusNotificationText,
  getUserStatusNotificationSubject,
  resolveUserStatusNotificationRecipients,
  sendUserStatusNotificationEmail,
} = await import('@/lib/user-status-email-server')

const getSendCommandInput = () => {
  const command = mocks.send.mock.calls[0]?.[0] as
    | { input?: Record<string, unknown> }
    | undefined

  return command?.input
}

describe('user-status-email-server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createSesServerClient.mockReturnValue({ send: mocks.send })
    mocks.send.mockResolvedValue({})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the affected user email even in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('TEST_EMAIL_RECIPIENT', 'test-recipient@example.com')

    expect(
      resolveUserStatusNotificationRecipients(' user@example.com '),
    ).toEqual(['user@example.com'])
  })

  it('builds deactivation text and HTML bodies with escaped names', () => {
    const input = {
      status: 'deactivated' as const,
      user: {
        email: 'new.user@example.com',
        name: 'New <User> & "Admin"',
      },
    }

    const text = buildUserStatusNotificationText(input)
    const html = buildUserStatusNotificationHtml(input)

    expect(getUserStatusNotificationSubject('deactivated')).toBe(
      'Your TaxTrack account has been deactivated',
    )
    expect(text).toContain('Hello New <User> & "Admin",')
    expect(text).toContain('administrator deactivated access')
    expect(text).toContain('can no longer sign in')
    expect(html).toContain('New &lt;User&gt; &amp; &quot;Admin&quot;')
    expect(html).not.toContain('Hello New <User>')
    expect(html).toContain('#009869')
  })

  it('builds reactivation text and HTML bodies', () => {
    const input = {
      status: 'reactivated' as const,
      user: {
        email: 'new.user@example.com',
        name: 'New User',
      },
    }

    const text = buildUserStatusNotificationText(input)
    const html = buildUserStatusNotificationHtml(input)

    expect(getUserStatusNotificationSubject('reactivated')).toBe(
      'Your TaxTrack account has been reactivated',
    )
    expect(text).toContain('Hello New User,')
    expect(text).toContain('administrator reactivated access')
    expect(text).toContain('sign-in access has been restored')
    expect(html).toContain('Your account has been reactivated')
    expect(html).toContain('sign-in access has been restored')
  })

  it('sends SES text and HTML email to the exact affected user', async () => {
    await sendUserStatusNotificationEmail({
      status: 'reactivated',
      user: {
        email: 'new.user@example.com',
        name: 'New User',
      },
    })

    expect(mocks.createSesServerClient).toHaveBeenCalledTimes(1)
    expect(getSendCommandInput()).toMatchObject({
      Source: 'TaxTrack <notifications@taxtrack.online>',
      Destination: {
        ToAddresses: ['new.user@example.com'],
      },
      Message: {
        Subject: {
          Charset: 'UTF-8',
          Data: 'Your TaxTrack account has been reactivated',
        },
        Body: {
          Text: {
            Charset: 'UTF-8',
            Data: expect.stringContaining('sign-in access has been restored'),
          },
          Html: {
            Charset: 'UTF-8',
            Data: expect.stringContaining('sign-in access has been restored'),
          },
        },
      },
    })
  })
})
