import { randomUUID } from 'node:crypto'

import { SendRawEmailCommand } from '@aws-sdk/client-ses'
import { formatTinForDisplay } from '@taxtrack/shared/utils/tin'
import { and, ilike, inArray, isNotNull, sql } from 'drizzle-orm'

import { createSesServerClient, getSesFromEmail } from '@/lib/aws-server'
import { getDb } from '@/lib/db'
import { buildReconciliationWorkbook } from '@/lib/reconciliation-report-server'
import { formatBillingPeriod } from '@/lib/reconciliation-report'
import {
  getPendingReconciliationCustomerEmailRows,
  getReconciliationRow,
} from '@/lib/reconciliation-server'
import { entities, masterlist, reconciliationResults } from '@/lib/schema'

type MasterlistContactRecord = Pick<
  typeof masterlist.$inferSelect,
  'customerName' | 'emailAddress'
>

type EntityRecord = Pick<
  typeof entities.$inferSelect,
  | 'companyName'
  | 'birRegisteredAddress'
  | 'zipCode'
  | 'tin'
  | 'emailAddress'
  | 'regionEmailAddress'
>

type ReconciliationEmailResult = {
  message: string
  to: Array<string>
  cc: Array<string>
  subject: string
  customerName: string
  sentRowCount: number
  sentRowIds: Array<number>
}

type EmailDestinations = {
  to: Array<string>
  cc: Array<string>
}

const RECON_ATTACHMENT_FILE_NAME = 'Outstanding-CWT-Reconciliation-Report.xlsx'

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

  const matches = rows
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
    })

  return matches.at(0)
}

const fetchCustomerMasterlistMatch = async (customerName: string) => {
  const db = getDb()
  const rows = await db
    .select({
      customerName: masterlist.customerName,
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

const fetchRequestingEntity = async (shortName: string) => {
  const db = getDb()
  const rows = await db
    .select({
      companyName: entities.companyName,
      birRegisteredAddress: entities.birRegisteredAddress,
      zipCode: entities.zipCode,
      tin: entities.tin,
      emailAddress: entities.emailAddress,
      regionEmailAddress: entities.regionEmailAddress,
    })
    .from(entities)
    .where(sql`lower(${entities.shortName}) = ${shortName.toLowerCase()}`)
    .limit(1)

  return rows.at(0) ?? null
}

const buildEntityCcEmails = (input: {
  entity: EntityRecord
  toEmail: string
}) =>
  Array.from(
    new Set(
      [input.entity.emailAddress, input.entity.regionEmailAddress]
        .flatMap(parseEmailList)
        .filter(
          (email) => email.toLowerCase() !== input.toEmail.trim().toLowerCase(),
        ),
    ),
  )

const entityFieldOrFallback = (value: string | null | undefined) =>
  normalizeText(value) || 'N/A'

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

const formatEmailPeriod = (
  rows: Awaited<ReturnType<typeof getPendingReconciliationCustomerEmailRows>>,
) => {
  const billingMonths = Array.from(
    new Set(rows.map((row) => row.derivedBillingMonthMMYY)),
  )

  return billingMonths.length === 1
    ? formatBillingPeriod(billingMonths[0])
    : 'See attached reconciliation breakdown'
}

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

  const requestingEntityShortName = normalizeText(row.requestingEntityShortName)
  if (!requestingEntityShortName) {
    throw new Error(
      'Requesting entity short name is missing from the reconciliation row.',
    )
  }

  const pendingRows = await getPendingReconciliationCustomerEmailRows(row)
  if (pendingRows.length === 0) {
    throw new Error('No pending reconciliation rows found for this customer.')
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

  const requestingEntity = await fetchRequestingEntity(
    requestingEntityShortName,
  )
  if (!requestingEntity) {
    throw new Error(
      `Requesting entity "${requestingEntityShortName}" was not found in the entities table.`,
    )
  }

  const ccEmails = buildEntityCcEmails({
    entity: requestingEntity,
    toEmail,
  })

  const destinations = resolveEmailDestinations({
    to: [toEmail],
    cc: ccEmails,
  })

  const requestingEntityName = entityFieldOrFallback(
    requestingEntity.companyName,
  )
  const requestingEntityAddress = entityFieldOrFallback(
    requestingEntity.birRegisteredAddress,
  )
  const requestingEntityTin = formatTinForDisplay(requestingEntity.tin) || 'N/A'
  const requestingEntityZipCode = entityFieldOrFallback(
    requestingEntity.zipCode,
  )
  const period = formatEmailPeriod(pendingRows)
  const subject = `Urgent Request for BIR Form 2307 | ${requestingEntityName}`
  const body = buildEmailBody({
    requestingEntityName,
    requestingEntityAddress,
    requestingEntityZipCode,
    requestingEntityTin,
    period,
  })
  const attachmentContent = await buildReconciliationWorkbook(pendingRows)
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

  const sentAt = new Date()
  const sentRowIds = pendingRows.map((pendingRow) => pendingRow.id)

  await getDb()
    .update(reconciliationResults)
    .set({
      emailSentAt: sentAt,
    })
    .where(inArray(reconciliationResults.id, sentRowIds))

  const rowLabel =
    sentRowIds.length === 1
      ? '1 reconciliation row'
      : `${sentRowIds.length} reconciliation rows`

  return {
    message: `Email sent to ${destinations.to.join(', ')} for ${rowLabel}.`,
    to: destinations.to,
    cc: destinations.cc,
    subject,
    customerName: row.customerName,
    sentRowCount: sentRowIds.length,
    sentRowIds,
  }
}
