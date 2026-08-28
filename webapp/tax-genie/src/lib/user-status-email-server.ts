import { SendEmailCommand } from '@aws-sdk/client-ses'

import { createSesServerClient } from '@/lib/aws-server'

type UserStatusNotificationUser = {
  email: string
  name?: string | null
}

export type UserStatusNotificationStatus = 'deactivated' | 'reactivated'

type SendUserStatusNotificationEmailInput = {
  status: UserStatusNotificationStatus
  user: UserStatusNotificationUser
}

const BRAND_NAME = 'TaxGenie'
const NOTIFICATION_FROM_EMAIL = 'TaxGenie <notifications@taxgenie.online>'
const EMAIL_THEME = {
  background: '#f5f5f5',
  border: '#e5e5e5',
  card: '#ffffff',
  foreground: '#0a0a0a',
  mutedForeground: '#737373',
  primary: '#009869',
  primaryForeground: '#edfdf5',
  subtleForeground: '#171717',
}

const STATUS_CONTENT = {
  deactivated: {
    heading: 'Your account has been deactivated',
    subject: `Your ${BRAND_NAME} account has been deactivated`,
    summary:
      'An administrator deactivated access for this account. You can no longer sign in to TaxGenie.',
    detail:
      'If you believe this was unexpected, contact your administrator for help.',
  },
  reactivated: {
    heading: 'Your account has been reactivated',
    subject: `Your ${BRAND_NAME} account has been reactivated`,
    summary:
      'An administrator reactivated access for this account. Your sign-in access has been restored.',
    detail:
      'If you did not expect this change, contact your administrator for help.',
  },
} satisfies Record<
  UserStatusNotificationStatus,
  {
    detail: string
    heading: string
    subject: string
    summary: string
  }
>

export const resolveUserStatusNotificationRecipients = (email: string) => {
  const recipient = email.trim()
  if (!recipient) {
    throw new Error('User email is required for status notification sending.')
  }

  return [recipient]
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

export const getUserStatusNotificationSubject = (
  status: UserStatusNotificationStatus,
) => STATUS_CONTENT[status].subject

export const buildUserStatusNotificationText = (
  input: SendUserStatusNotificationEmailInput,
) => {
  const name = input.user.name?.trim()
  const greeting = name ? `Hello ${name},` : 'Hello,'
  const content = STATUS_CONTENT[input.status]

  return `${greeting}

${content.summary}

${content.detail}

${BRAND_NAME}`
}

export const buildUserStatusNotificationHtml = (
  input: SendUserStatusNotificationEmailInput,
) => {
  const name = input.user.name?.trim()
  const greeting = name ? `Hello ${escapeHtml(name)},` : 'Hello,'
  const content = STATUS_CONTENT[input.status]

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(content.subject)}</title>
  </head>
  <body style="margin:0;background:${EMAIL_THEME.background};color:${EMAIL_THEME.foreground};font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${EMAIL_THEME.background};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:${EMAIL_THEME.card};border:1px solid ${EMAIL_THEME.border};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 12px;">
                <div style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_THEME.primary};">${BRAND_NAME}</div>
                <h1 style="margin:18px 0 10px;font-size:24px;line-height:1.25;color:${EMAIL_THEME.foreground};">${escapeHtml(content.heading)}</h1>
                <p style="margin:0;font-size:15px;line-height:1.6;color:${EMAIL_THEME.mutedForeground};">${greeting}</p>
                <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:${EMAIL_THEME.mutedForeground};">${escapeHtml(content.summary)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 28px;">
                <div style="background:${EMAIL_THEME.background};border:1px solid ${EMAIL_THEME.border};border-radius:10px;padding:16px;">
                  <p style="margin:0;font-size:14px;line-height:1.6;color:${EMAIL_THEME.subtleForeground};">${escapeHtml(content.detail)}</p>
                </div>
                <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:${EMAIL_THEME.mutedForeground};">This notification was sent because your ${BRAND_NAME} account access changed.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export const sendUserStatusNotificationEmail = async (
  input: SendUserStatusNotificationEmailInput,
) => {
  const to = resolveUserStatusNotificationRecipients(input.user.email)
  const ses = createSesServerClient()

  await ses.send(
    new SendEmailCommand({
      Source: NOTIFICATION_FROM_EMAIL,
      Destination: {
        ToAddresses: to,
      },
      Message: {
        Subject: {
          Charset: 'UTF-8',
          Data: getUserStatusNotificationSubject(input.status),
        },
        Body: {
          Text: {
            Charset: 'UTF-8',
            Data: buildUserStatusNotificationText(input),
          },
          Html: {
            Charset: 'UTF-8',
            Data: buildUserStatusNotificationHtml(input),
          },
        },
      },
    }),
  )
}
