import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { AuditUserSummary } from '@/lib/audit-display'
import type { AuditEventType, AuditTargetType } from '@/lib/audit-types'
import type { SecurityAuditLogRecord } from '@/lib/schema'
import {
  AUDIT_PAGE_SIZE_OPTIONS,
  DEFAULT_AUDIT_PAGE_SIZE,
} from '@/lib/audit-search-state'
import { formatAuditAction } from '@/lib/audit-display'
import { auditEventTypes } from '@/lib/audit-types'
import { authUserTable, securityAuditLogs } from '@/lib/schema'
import { getDb } from '@/lib/db'

type AccessAuditPayload = {
  actorUserId?: string | null
  targetId?: string | null
  targetType?: AuditTargetType | null
  eventType: AuditEventType
  metadata?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
}

export type AuditEventView = SecurityAuditLogRecord & {
  actor: AuditUserSummary | null
  target: AuditUserSummary | null
}

export type ListAuditEventsOptions = {
  q?: string | null
  action?: AuditEventType | null
  actor?: string | null
  targetType?: AuditTargetType | null
  dateFrom?: Date | null
  dateTo?: Date | null
  page?: number | null
  pageSize?: number | null
}

export type AuditEventPagination = {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

export type AuditEventSummary = {
  totalEvents: number
  uniqueActors: number
  systemEvents: number
}

export type ListAuditEventsResult = {
  events: Array<AuditEventView>
  pagination: AuditEventPagination
  summary: AuditEventSummary
}

type CountRow = {
  value: number
}

type AuditDb = ReturnType<typeof getDb>

const normalizeText = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

const resolveIpAddress = (request: Request): string | null => {
  const forwardedFor = request.headers
    .get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim()
  if (forwardedFor) {
    return normalizeText(forwardedFor)
  }

  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) {
    return normalizeText(realIp)
  }

  const cfConnectingIp = request.headers.get('cf-connecting-ip')?.trim()
  if (cfConnectingIp) {
    return normalizeText(cfConnectingIp)
  }

  const forwardedHost = request.headers.get('x-forwarded-host')?.trim()
  if (forwardedHost) {
    return normalizeText(forwardedHost)
  }

  return null
}

export const logAuditEvent = async (
  request: Request,
  payload: AccessAuditPayload,
) => {
  const db = getDb()

  await db.insert(securityAuditLogs).values({
    eventType: payload.eventType,
    actorUserId: payload.actorUserId ?? null,
    targetId: payload.targetId ?? null,
    targetType: payload.targetType ?? null,
    metadata: payload.metadata ?? null,
    ipAddress: resolveIpAddress(request),
    userAgent: normalizeText(request.headers.get('user-agent')),
  })
}

const toAuditUserSummary = (user: {
  id: string
  name: string
  email: string
}): AuditUserSummary => ({
  id: user.id,
  name: user.name,
  email: user.email,
})

const readCount = (rows: Array<CountRow>) => Number(rows.at(0)?.value ?? 0)

const normalizePageSize = (value: number | null | undefined) =>
  AUDIT_PAGE_SIZE_OPTIONS.includes(
    value as (typeof AUDIT_PAGE_SIZE_OPTIONS)[number],
  )
    ? Number(value)
    : DEFAULT_AUDIT_PAGE_SIZE

const toLikePattern = (value: string) => `%${value.replaceAll('%', '\\%')}%`

const findMatchingUserIds = async (db: AuditDb, value: string) => {
  const searchText = normalizeText(value)
  if (!searchText) {
    return []
  }

  const pattern = toLikePattern(searchText)
  const users = await db
    .select({
      id: authUserTable.id,
    })
    .from(authUserTable)
    .where(
      or(
        ilike(authUserTable.id, pattern),
        ilike(authUserTable.name, pattern),
        ilike(authUserTable.email, pattern),
      ),
    )

  return users.map((user) => user.id)
}

const getMatchingActionTypes = (value: string) => {
  const normalized = value.toLowerCase()

  return auditEventTypes.filter((eventType) =>
    formatAuditAction(eventType).toLowerCase().includes(normalized),
  )
}

const buildWhereCondition = ({
  options,
  searchUserIds,
  actorUserIds,
}: {
  options: Required<Pick<ListAuditEventsOptions, 'page' | 'pageSize'>> &
    Omit<ListAuditEventsOptions, 'page' | 'pageSize'>
  searchUserIds: Array<string>
  actorUserIds: Array<string>
}) => {
  const conditions: Array<SQL> = []
  const searchText = normalizeText(options.q ?? null)
  const actorText = normalizeText(options.actor ?? null)

  if (options.action) {
    conditions.push(eq(securityAuditLogs.eventType, options.action))
  }

  if (options.targetType) {
    conditions.push(eq(securityAuditLogs.targetType, options.targetType))
  }

  if (options.dateFrom) {
    conditions.push(gte(securityAuditLogs.occurredAt, options.dateFrom))
  }

  if (options.dateTo) {
    conditions.push(lte(securityAuditLogs.occurredAt, options.dateTo))
  }

  if (actorText) {
    const actorConditions: Array<SQL> = [
      ilike(securityAuditLogs.actorUserId, toLikePattern(actorText)),
    ]

    if (actorUserIds.length > 0) {
      actorConditions.push(inArray(securityAuditLogs.actorUserId, actorUserIds))
    }

    if ('system'.includes(actorText.toLowerCase())) {
      actorConditions.push(isNull(securityAuditLogs.actorUserId))
    }

    conditions.push(or(...actorConditions) ?? sql`false`)
  }

  if (searchText) {
    const pattern = toLikePattern(searchText)
    const matchingActionTypes = getMatchingActionTypes(searchText)
    const searchConditions: Array<SQL> = [
      ilike(securityAuditLogs.eventType, pattern),
      ilike(securityAuditLogs.actorUserId, pattern),
      ilike(securityAuditLogs.targetId, pattern),
      sql`${securityAuditLogs.metadata}::text ilike ${pattern}`,
    ]

    if (matchingActionTypes.length > 0) {
      searchConditions.push(
        inArray(securityAuditLogs.eventType, matchingActionTypes),
      )
    }

    if (searchUserIds.length > 0) {
      searchConditions.push(
        inArray(securityAuditLogs.actorUserId, searchUserIds),
        and(
          eq(securityAuditLogs.targetType, 'user'),
          inArray(securityAuditLogs.targetId, searchUserIds),
        ) ?? sql`false`,
      )
    }

    conditions.push(or(...searchConditions) ?? sql`false`)
  }

  return conditions.length > 0 ? (and(...conditions) ?? sql`true`) : sql`true`
}

const resolveAuditUsers = async (
  db: AuditDb,
  events: Array<SecurityAuditLogRecord>,
) => {
  const userIds = Array.from(
    new Set(
      events.flatMap((event) =>
        [
          event.actorUserId,
          event.targetType === 'user' ? event.targetId : null,
        ].filter((userId): userId is string => Boolean(userId)),
      ),
    ),
  )

  if (userIds.length === 0) {
    return new Map<string, AuditUserSummary>()
  }

  const users = await db
    .select({
      id: authUserTable.id,
      name: authUserTable.name,
      email: authUserTable.email,
    })
    .from(authUserTable)
    .where(inArray(authUserTable.id, userIds))

  return new Map(users.map((user) => [user.id, toAuditUserSummary(user)]))
}

export const listAuditEvents = async (
  input: ListAuditEventsOptions = {},
): Promise<ListAuditEventsResult> => {
  const db = getDb()
  const page = Math.max(1, input.page ?? 1)
  const pageSize = normalizePageSize(input.pageSize)
  const offset = (page - 1) * pageSize
  const options = {
    ...input,
    page,
    pageSize,
  }
  const [searchUserIds, actorUserIds] = await Promise.all([
    findMatchingUserIds(db, input.q ?? ''),
    findMatchingUserIds(db, input.actor ?? ''),
  ])
  const whereCondition = buildWhereCondition({
    options,
    searchUserIds,
    actorUserIds,
  })

  const [totalRows, actorRows, systemRows, events] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(securityAuditLogs)
      .where(whereCondition),
    db
      .select({
        value: sql<number>`count(distinct coalesce(${securityAuditLogs.actorUserId}, 'System'))::int`,
      })
      .from(securityAuditLogs)
      .where(whereCondition),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(securityAuditLogs)
      .where(and(whereCondition, isNull(securityAuditLogs.actorUserId))),
    db
      .select()
      .from(securityAuditLogs)
      .where(whereCondition)
      .orderBy(desc(securityAuditLogs.occurredAt))
      .limit(pageSize)
      .offset(offset),
  ])

  const totalItems = readCount(totalRows)
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const usersById = await resolveAuditUsers(db, events)

  return {
    events: events.map((event) => ({
      ...event,
      actor: event.actorUserId
        ? (usersById.get(event.actorUserId) ?? null)
        : null,
      target:
        event.targetType === 'user' && event.targetId
          ? (usersById.get(event.targetId) ?? null)
          : null,
    })),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: page * pageSize < totalItems,
      hasPreviousPage: page > 1,
    },
    summary: {
      totalEvents: totalItems,
      uniqueActors: readCount(actorRows),
      systemEvents: readCount(systemRows),
    },
  }
}
