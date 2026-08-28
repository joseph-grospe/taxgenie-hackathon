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
  buildVerificationEmailHtml,
  buildVerificationEmailText,
  resolveAuthEmailRecipients,
  sendAuthVerificationEmail,
} = await import('@/lib/auth-email-server')

const getSendCommandInput = () => {
  const command = mocks.send.mock.calls[0]?.[0] as
    | { input?: Record<string, unknown> }
    | undefined

  return command?.input
}

describe('auth-email-server', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createSesServerClient.mockReturnValue({ send: mocks.send })
    mocks.send.mockResolvedValue({})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the account email even in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv(
      'TEST_EMAIL_RECIPIENT',
      'test-one@example.com; test-two@example.com',
    )

    expect(resolveAuthEmailRecipients(' real-user@example.com ')).toEqual([
      'real-user@example.com',
    ])
  })

  it('builds verification email bodies without including a temporary password', () => {
    const input = {
      user: {
        email: 'new.user@example.com',
        name: 'New <User>',
      },
      url: 'https://taxgenie.example.com/api/auth/verify-email?token=abc',
      token: 'abc',
    }
    const text = buildVerificationEmailText(input)
    const html = buildVerificationEmailHtml(input)

    expect(text).toContain('Hello New <User>')
    expect(text).toContain('finish setting up your account')
    expect(text).toContain('This link expires in 24 hours')
    expect(text.toLowerCase()).not.toContain('temporary password')
    expect(html).toContain('<a href="https://taxgenie.example.com')
    expect(html).toContain('Verify email')
    expect(html).toContain('New &lt;User&gt;')
    expect(html).toContain('#009869')
    expect(html).not.toContain('#2563eb')
    expect(html.toLowerCase()).not.toContain('temporary password')
  })

  it('sends SES text and HTML email to the resolved recipients', async () => {
    await sendAuthVerificationEmail({
      user: {
        email: 'new.user@example.com',
        name: 'New User',
      },
      url: 'https://taxgenie.example.com/api/auth/verify-email?token=abc',
      token: 'abc',
    })

    expect(mocks.createSesServerClient).toHaveBeenCalledTimes(1)
    expect(getSendCommandInput()).toMatchObject({
      Source: 'TaxGenie <verify@taxgenie.online>',
      Destination: {
        ToAddresses: ['new.user@example.com'],
      },
      Message: {
        Subject: {
          Charset: 'UTF-8',
          Data: 'Verify your TaxGenie email',
        },
        Body: {
          Text: {
            Charset: 'UTF-8',
          },
          Html: {
            Charset: 'UTF-8',
          },
        },
      },
    })
  })
})
