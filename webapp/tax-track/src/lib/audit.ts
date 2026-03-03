import { desc } from 'drizzle-orm'

import { securityAuditLogs, type AuditEventType } from '@/lib/schema'
import { getDb } from '@/lib/db'

type AccessAuditPayload = {
  actorUserId?: string | null
  targetUserId?: string | null
  eventType: AuditEventType
  metadata?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
}

const normalizeText = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

const resolveIpAddress = (request: Request): string | null => {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
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
    targetUserId: payload.targetUserId ?? null,
    metadata: payload.metadata ?? null,
    ipAddress: resolveIpAddress(request),
    userAgent: normalizeText(request.headers.get('user-agent')),
  })
}

export const listAuditEvents = async (limit = 100) => {
  const db = getDb()
  return db
    .select()
    .from(securityAuditLogs)
    .orderBy(desc(securityAuditLogs.occurredAt))
    .limit(limit)
}
