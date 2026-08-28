import { SendEmailCommand } from '@aws-sdk/client-ses'

import { createSesServerClient } from '@/lib/aws-server'

type VerificationEmailUser = {
  email: string
  name?: string | null
}

type SendAuthVerificationEmailInput = {
  user: VerificationEmailUser
  url: string
  token: string
}

const VERIFICATION_LINK_EXPIRES_HOURS = 24
const BRAND_NAME = 'TaxGenie'
const VERIFICATION_FROM_EMAIL = 'TaxGenie <verify@taxgenie.online>'
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

export const resolveAuthEmailRecipients = (email: string) => {
  const recipient = email.trim()
  if (!recipient) {
    throw new Error('User email is required for verification email sending.')
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

export const buildVerificationEmailText = (
  input: SendAuthVerificationEmailInput,
) => {
  const name = input.user.name?.trim()
  const greeting = name ? `Hello ${name},` : 'Hello,'

  return `${greeting}

An administrator created a ${BRAND_NAME} account for this email address.

Please verify your email address to finish setting up your account:
${input.url}

This link expires in ${VERIFICATION_LINK_EXPIRES_HOURS} hours. After verification, sign in with the credentials provided by your administrator.

If you did not expect this account, you can ignore this email.

${BRAND_NAME}`
}

export const buildVerificationEmailHtml = (
  input: SendAuthVerificationEmailInput,
) => {
  const name = input.user.name?.trim()
  const greeting = name ? `Hello ${escapeHtml(name)},` : 'Hello,'
  const verificationUrl = escapeHtml(input.url)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verify your ${BRAND_NAME} email</title>
  </head>
  <body style="margin:0;background:${EMAIL_THEME.background};color:${EMAIL_THEME.foreground};font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${EMAIL_THEME.background};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:${EMAIL_THEME.card};border:1px solid ${EMAIL_THEME.border};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 12px;">
                <div style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_THEME.primary};">${BRAND_NAME}</div>
                <h1 style="margin:18px 0 10px;font-size:24px;line-height:1.25;color:${EMAIL_THEME.foreground};">Verify your email address</h1>
                <p style="margin:0;font-size:15px;line-height:1.6;color:${EMAIL_THEME.mutedForeground};">${greeting}</p>
                <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:${EMAIL_THEME.mutedForeground};">An administrator created a ${BRAND_NAME} account for this email address. Confirm it is yours to finish setting up your account.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 24px;">
                <a href="${verificationUrl}" style="display:inline-block;background:${EMAIL_THEME.primary};color:${EMAIL_THEME.primaryForeground};text-decoration:none;font-size:15px;font-weight:700;line-height:1;padding:14px 18px;border-radius:8px;">Verify email</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;">
                <div style="background:${EMAIL_THEME.background};border:1px solid ${EMAIL_THEME.border};border-radius:10px;padding:16px;">
                  <p style="margin:0;font-size:14px;line-height:1.6;color:${EMAIL_THEME.subtleForeground};">This link expires in ${VERIFICATION_LINK_EXPIRES_HOURS} hours. After verification, sign in with the credentials provided by your administrator.</p>
                </div>
                <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:${EMAIL_THEME.mutedForeground};">If the button does not work, copy and paste this link into your browser:</p>
                <p style="margin:6px 0 0;font-size:13px;line-height:1.6;color:${EMAIL_THEME.primary};word-break:break-all;"><a href="${verificationUrl}" style="color:${EMAIL_THEME.primary};">${verificationUrl}</a></p>
                <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:${EMAIL_THEME.mutedForeground};">If you did not expect this account, you can ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export const sendAuthVerificationEmail = async (
  input: SendAuthVerificationEmailInput,
) => {
  const to = resolveAuthEmailRecipients(input.user.email)
  const ses = createSesServerClient()

  await ses.send(
    new SendEmailCommand({
      Source: VERIFICATION_FROM_EMAIL,
      Destination: {
        ToAddresses: to,
      },
      Message: {
        Subject: {
          Charset: 'UTF-8',
          Data: 'Verify your TaxGenie email',
        },
        Body: {
          Text: {
            Charset: 'UTF-8',
            Data: buildVerificationEmailText(input),
          },
          Html: {
            Charset: 'UTF-8',
            Data: buildVerificationEmailHtml(input),
          },
        },
      },
    }),
  )
}
