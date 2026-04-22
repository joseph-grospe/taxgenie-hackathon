import { randomUUID } from 'node:crypto'

import { SendRawEmailCommand } from '@aws-sdk/client-ses'
import { and, eq, ilike, isNotNull, or } from 'drizzle-orm'

import { createSesServerClient, getSesFromEmail } from '@/lib/aws-server'
import { getDb } from '@/lib/db'
import { buildReconciliationWorkbook } from '@/lib/reconciliation-report-server'
import { formatBillingPeriod } from '@/lib/reconciliation-report'
import { getReconciliationRow } from '@/lib/reconciliation-server'
import { masterlist, reconciliationResults } from '@/lib/schema'

type MasterlistContactRecord = Pick<
  typeof masterlist.$inferSelect,
  | 'region'
  | 'entity'
  | 'shortName'
  | 'customerName'
  | 'tin'
  | 'address'
  | 'emailAddress'
>

type ReconciliationEmailResult = {
  message: string
  to: Array<string>
  cc: Array<string>
  subject: string
}

type EmailDestinations = {
  to: Array<string>
  cc: Array<string>
}

const RECON_ATTACHMENT_FILE_NAME =
  'Outstanding-CWT-Reconciliation-Report.xlsx'

const escapeLikePattern = (value: string) => value.replaceAll(/[%_\\]/g, '\\$&')

const normalizeText = (value: string | null | undefined) => value?.trim() ?? ''

const normalizeComparisonValue = (value: string | null | undefined) =>
  normalizeText(value).toLowerCase()

const parseEmailList = (value: string | null | undefined) =>
  Array.from(
    new Set(
      normalizeText(value)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  )

const resolveEmailDestinations = (
  input: EmailDestinations,
): EmailDestinations => {
  if (process.env.NODE_ENV !== 'development') {
    return input
  }

  const testRecipients = parseEmailList(process.env.TEST_EMAIL_RECIPIENT)
  if (testRecipients.length === 0) {
    throw new Error(
      'TEST_EMAIL_RECIPIENT is not configured for development email sending.',
    )
  }

  return {
    to: testRecipients,
    cc: [],
  }
}

const pickBestCustomerMatch = (
  requestedCustomerName: string,
  rows: Array<MasterlistContactRecord>,
) => {
  const requestedName = requestedCustomerName.trim()
  const requestedNameLower = requestedName.toLowerCase()

  return rows
    .filter((row) => {
      const customerName = normalizeText(row.customerName)
      const emailAddress = normalizeText(row.emailAddress)

      return (
        customerName.toLowerCase().includes(requestedNameLower) &&
        emailAddress.length > 0
      )
    })
    .sort((left, right) => {
      const leftCustomerName = normalizeText(left.customerName)
      const rightCustomerName = normalizeText(right.customerName)
      const leftExactMatch =
        normalizeComparisonValue(leftCustomerName) === requestedNameLower
          ? 0
          : 1
      const rightExactMatch =
        normalizeComparisonValue(rightCustomerName) === requestedNameLower
          ? 0
          : 1

      if (leftExactMatch !== rightExactMatch) {
        return leftExactMatch - rightExactMatch
      }

      if (leftCustomerName.length !== rightCustomerName.length) {
        return leftCustomerName.length - rightCustomerName.length
      }

      return leftCustomerName.localeCompare(rightCustomerName)
    })[0]
}

const pickBestEntityContact = (
  customerRow: MasterlistContactRecord,
  rows: Array<MasterlistContactRecord>,
) => {
  const region = normalizeText(customerRow.region)
  const entity = normalizeText(customerRow.entity)
  const customerEmail = normalizeComparisonValue(customerRow.emailAddress)

  return rows
    .filter((row) => {
      const rowEmail = normalizeText(row.emailAddress)
      if (!rowEmail) {
        return false
      }

      if (normalizeComparisonValue(rowEmail) === customerEmail) {
        return false
      }

      return true
    })
    .sort((left, right) => {
      const leftRegion = normalizeText(left.region)
      const rightRegion = normalizeText(right.region)
      const leftEntity = normalizeText(left.entity)
      const rightEntity = normalizeText(right.entity)
      const leftCustomerName = normalizeText(left.customerName)
      const rightCustomerName = normalizeText(right.customerName)

      const leftExactRegion = leftRegion === region ? 0 : 1
      const rightExactRegion = rightRegion === region ? 0 : 1
      if (leftExactRegion !== rightExactRegion) {
        return leftExactRegion - rightExactRegion
      }

      const leftExactEntity =
        leftEntity === entity || leftCustomerName === entity ? 0 : 1
      const rightExactEntity =
        rightEntity === entity || rightCustomerName === entity ? 0 : 1
      if (leftExactEntity !== rightExactEntity) {
        return leftExactEntity - rightExactEntity
      }

      const leftDistance = Math.abs(leftCustomerName.length - entity.length)
      const rightDistance = Math.abs(rightCustomerName.length - entity.length)
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance
      }

      return leftCustomerName.localeCompare(rightCustomerName)
    })[0]
}

const fetchCustomerMasterlistMatch = async (customerName: string) => {
  const db = getDb()
  const rows = await db
    .select({
      region: masterlist.region,
      entity: masterlist.entity,
      shortName: masterlist.shortName,
      customerName: masterlist.customerName,
      tin: masterlist.tin,
      address: masterlist.address,
      emailAddress: masterlist.emailAddress,
    })
    .from(masterlist)
    .where(
      and(
        isNotNull(masterlist.emailAddress),
        ilike(
          masterlist.customerName,
          `%${escapeLikePattern(customerName.trim())}%`,
        ),
      ),
    )
    .limit(20)

  return pickBestCustomerMatch(customerName, rows)
}

const fetchEntityCcMatch = async (customerRow: MasterlistContactRecord) => {
  const region = normalizeText(customerRow.region)
  const entity = normalizeText(customerRow.entity)
  const db = getDb()

  if (!region && !entity) {
    return null
  }

  const conditions = []
  if (region) {
    conditions.push(eq(masterlist.region, region))
  }

  if (entity) {
    conditions.push(
      or(
        ilike(masterlist.entity, `%${escapeLikePattern(entity)}%`),
        ilike(masterlist.customerName, `%${escapeLikePattern(entity)}%`),
      ),
    )
  }

  const rows = await db
    .select({
      region: masterlist.region,
      entity: masterlist.entity,
      shortName: masterlist.shortName,
      customerName: masterlist.customerName,
      tin: masterlist.tin,
      address: masterlist.address,
      emailAddress: masterlist.emailAddress,
    })
    .from(masterlist)
    .where(and(isNotNull(masterlist.emailAddress), ...conditions))
    .limit(20)

  return pickBestEntityContact(customerRow, rows)
}

const extractZipCode = (address: string | null | undefined) =>
  address?.match(/\b\d{4}\b/)?.[0] ?? 'N/A'

const wrapBase64 = (value: string) =>
  value.replace(/.{1,76}/g, '$&\r\n').trimEnd()

const encodeSubject = (value: string) =>
  `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`

const buildEmailBody = (input: {
  requestingEntityName: string
  requestingEntityAddress: string
  requestingEntityZipCode: string
  requestingEntityTin: string
  period: string
}) => `Dear Valued Customers,

Good day.

We would like to kindly request a copy of the previously unsubmitted Certificate of Creditable Tax Withheld at Source (BIR Form 2307). For your convenience, we have attached the breakdown of the outstanding CWT certificates for your reference.

In addition, please ensure that the following details are correctly reflected in the certificate:

Company Name: ${input.requestingEntityName}
BIR Registered Address: ${input.requestingEntityAddress}
Zip Code: ${input.requestingEntityZipCode}
TIN: ${input.requestingEntityTin}
Period: ${input.period}

We would greatly appreciate your prompt attention to this matter. Should you have any questions or require further clarification, please feel free to reply to this email.

If you are not the appropriate contact person for this request, we kindly ask that you forward this email to the concerned team.

Thank you for your continued cooperation and support.

Regards,

AR Team`

const buildRawEmailMessage = (input: {
  from: string
  to: Array<string>
  cc: Array<string>
  subject: string
  body: string
  attachmentFileName: string
  attachmentContent: Buffer
  attachmentContentType: string
}) => {
  const boundary = `TaxTrackBoundary_${randomUUID()}`
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to.join(', ')}`,
    input.cc.length > 0 ? `Cc: ${input.cc.join(', ')}` : null,
    `Subject: ${encodeSubject(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ]
    .filter(Boolean)
    .join('\r\n')

  const attachmentBase64 = wrapBase64(
    input.attachmentContent.toString('base64'),
  )

  return `${headers}\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${input.body}\r\n\r\n--${boundary}\r\nContent-Type: ${input.attachmentContentType}; name="${input.attachmentFileName}"\r\nContent-Disposition: attachment; filename="${input.attachmentFileName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${attachmentBase64}\r\n--${boundary}--`
}

export const sendReconciliationEmail = async (
  rowId: number,
): Promise<ReconciliationEmailResult> => {
  const row = await getReconciliationRow(rowId)
  if (!row) {
    throw new Error('Reconciliation row not found.')
  }

  if (!row.hasDifference || row.matchStatus !== 'unmatched') {
    throw new Error(
      'Email is only available for unmatched rows with differences.',
    )
  }

  if (row.emailSentAt) {
    throw new Error('Email was already sent for this reconciliation row.')
  }

  const customerMatch = await fetchCustomerMasterlistMatch(row.customerName)
  if (!customerMatch) {
    throw new Error(
      'Customer masterlist entry with email address was not found.',
    )
  }

  const toEmail = normalizeText(customerMatch.emailAddress)
  if (!toEmail) {
    throw new Error('Customer email address is missing from the masterlist.')
  }

  const entityMatch = await fetchEntityCcMatch(customerMatch)
  const ccEmails = Array.from(
    new Set(
      [normalizeText(entityMatch?.emailAddress)]
        .filter(Boolean)
        .filter((email) => email.toLowerCase() !== toEmail.toLowerCase()),
    ),
  )
  const destinations = resolveEmailDestinations({
    to: [toEmail],
    cc: ccEmails,
  })

  const requestingEntityName =
    normalizeText(customerMatch.customerName) || row.customerName

  const requestingEntityAddress = normalizeText(customerMatch.address) || 'N/A'
  const requestingEntityTin =
    normalizeText(customerMatch.tin) || row.tin || 'N/A'
  const requestingEntityZipCode = extractZipCode(customerMatch.address)
  const period = formatBillingPeriod(row.derivedBillingMonthMMYY)
  const subject = `Urgent Request for BIR Form 2307 | ${requestingEntityName}`
  const body = buildEmailBody({
    requestingEntityName,
    requestingEntityAddress,
    requestingEntityZipCode,
    requestingEntityTin,
    period,
  })
  const attachmentContent = await buildReconciliationWorkbook([row])
  const attachmentFileName = RECON_ATTACHMENT_FILE_NAME
  const rawEmail = buildRawEmailMessage({
    from: getSesFromEmail(),
    to: destinations.to,
    cc: destinations.cc,
    subject,
    body,
    attachmentFileName,
    attachmentContent,
    attachmentContentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const ses = createSesServerClient()
  await ses.send(
    new SendRawEmailCommand({
      Destinations: [...destinations.to, ...destinations.cc],
      RawMessage: {
        Data: Buffer.from(rawEmail, 'utf8'),
      },
      Source: getSesFromEmail(),
    }),
  )

  await getDb()
    .update(reconciliationResults)
    .set({
      emailSentAt: new Date(),
    })
    .where(eq(reconciliationResults.id, rowId))

  return {
    message: `Email sent to ${destinations.to.join(', ')}.`,
    to: destinations.to,
    cc: destinations.cc,
    subject,
  }
}
