import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'

import type {
  AuditEventView,
  AuditExportFormat,
  ExportAuditEventsOptions,
} from '@/lib/audit'
import { listAllAuditEvents } from '@/lib/audit'
import { MANILA_TIME_ZONE_OFFSET_MS } from '@/lib/audit-search-state'
import { formatAuditAction } from '@/lib/audit-display'

export type AuditExportResult = {
  fileName: string
  content: Buffer
  contentType: string
  rowCount: number
}

const AUDIT_EXPORT_COLUMNS = [
  { key: 'auditId', header: 'Audit ID', width: 38 },
  { key: 'occurredAtUtc', header: 'Occurred at (UTC)', width: 24 },
  {
    key: 'occurredAtManila',
    header: 'Occurred at (Asia/Manila)',
    width: 28,
  },
  { key: 'eventType', header: 'Event type', width: 28 },
  { key: 'actionLabel', header: 'Action', width: 30 },
  { key: 'actorUserId', header: 'Actor user ID', width: 32 },
  { key: 'actorName', header: 'Actor name', width: 28 },
  { key: 'actorEmail', header: 'Actor email', width: 34 },
  { key: 'targetType', header: 'Target type', width: 16 },
  { key: 'targetId', header: 'Target ID', width: 32 },
  { key: 'targetName', header: 'Target name', width: 28 },
  { key: 'targetEmail', header: 'Target email', width: 34 },
  { key: 'metadataJson', header: 'Metadata JSON', width: 50 },
  { key: 'ipAddress', header: 'IP address', width: 22 },
  { key: 'userAgent', header: 'User agent', width: 60 },
] as const

type AuditExportColumnKey = (typeof AUDIT_EXPORT_COLUMNS)[number]['key']
type AuditExportRow = Record<AuditExportColumnKey, string>

const pad2 = (value: number) => String(value).padStart(2, '0')

const getValidDate = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const formatManilaDateTime = (value: Date | string) => {
  const date = getValidDate(value)
  if (!date) {
    return ''
  }

  const manilaDate = new Date(date.getTime() + MANILA_TIME_ZONE_OFFSET_MS)
  const datePart = [
    manilaDate.getUTCFullYear(),
    pad2(manilaDate.getUTCMonth() + 1),
    pad2(manilaDate.getUTCDate()),
  ].join('-')
  const timePart = [
    pad2(manilaDate.getUTCHours()),
    pad2(manilaDate.getUTCMinutes()),
    pad2(manilaDate.getUTCSeconds()),
  ].join(':')

  return `${datePart} ${timePart}`
}

const formatUtcDateTime = (value: Date | string) => {
  const date = getValidDate(value)
  return date ? date.toISOString() : ''
}

const stringifyMetadata = (value: unknown) => {
  if (value === null || typeof value === 'undefined') {
    return ''
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const toAuditExportRow = (event: AuditEventView): AuditExportRow => ({
  auditId: event.id,
  occurredAtUtc: formatUtcDateTime(event.occurredAt),
  occurredAtManila: formatManilaDateTime(event.occurredAt),
  eventType: event.eventType,
  actionLabel: formatAuditAction(event.eventType),
  actorUserId: event.actorUserId ?? '',
  actorName: event.actor?.name ?? (event.actorUserId ? '' : 'System'),
  actorEmail: event.actor?.email ?? '',
  targetType: event.targetType ?? '',
  targetId: event.targetId ?? '',
  targetName: event.target?.name ?? '',
  targetEmail: event.target?.email ?? '',
  metadataJson: stringifyMetadata(event.metadata),
  ipAddress: event.ipAddress ?? '',
  userAgent: event.userAgent ?? '',
})

const buildAuditCsv = (rows: Array<AuditExportRow>) => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    AUDIT_EXPORT_COLUMNS.map((column) => column.header),
    ...rows.map((row) =>
      AUDIT_EXPORT_COLUMNS.map((column) => row[column.key]),
    ),
  ])

  return Buffer.from(XLSX.utils.sheet_to_csv(worksheet), 'utf8')
}

const buildAuditWorkbook = async (rows: Array<AuditExportRow>) => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'TaxTrack'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet('Audit Trail')
  worksheet.columns = AUDIT_EXPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }))
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.getRow(1).font = { bold: true }
  worksheet.getRow(1).alignment = { vertical: 'middle' }

  rows.forEach((row) => worksheet.addRow(row))

  return Buffer.from(await workbook.xlsx.writeBuffer()) as unknown as Buffer
}

const formatAuditExportFileTimestamp = (date: Date) => {
  const manilaDate = new Date(date.getTime() + MANILA_TIME_ZONE_OFFSET_MS)

  return `${manilaDate.getUTCFullYear()}${pad2(
    manilaDate.getUTCMonth() + 1,
  )}${pad2(manilaDate.getUTCDate())}-${pad2(
    manilaDate.getUTCHours(),
  )}${pad2(manilaDate.getUTCMinutes())}${pad2(manilaDate.getUTCSeconds())}`
}

export const buildAuditExportFileName = (
  format: AuditExportFormat,
  date = new Date(),
) => `Audit-Trail-${formatAuditExportFileTimestamp(date)}.${format}`

export const buildAuditExport = async (
  events: Array<AuditEventView>,
  format: AuditExportFormat,
): Promise<AuditExportResult> => {
  const rows = events.map(toAuditExportRow)
  const content =
    format === 'csv' ? buildAuditCsv(rows) : await buildAuditWorkbook(rows)

  return {
    fileName: buildAuditExportFileName(format),
    content,
    contentType:
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    rowCount: rows.length,
  }
}

export const exportAuditEvents = async (
  input: ExportAuditEventsOptions,
  format: AuditExportFormat,
) => buildAuditExport(await listAllAuditEvents(input), format)
