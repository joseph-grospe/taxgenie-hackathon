import type { AuditTargetType } from '@/lib/audit-types'
import { auditEventTypes } from '@/lib/audit-types'

export type AuditUserSummary = {
  id: string
  name: string
  email: string
}

export type AuditUserDisplay = {
  label: string
  detail?: string
}

export type AuditTargetDisplay = AuditUserDisplay

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  certificate_resigned: 'Certificate re-signed',
  certificate_sign_failed: 'Certificate signing failed',
  certificate_signed: 'Certificate signed',
  dev_data_reset: 'Development data reset',
  login_failed: 'Login failed',
  login_succeeded: 'Login succeeded',
  password_changed_first_login: 'Password changed at first login',
  password_changed_self: 'Password changed',
  signature_profile_updated: 'Signature profile updated',
  user_created: 'User created',
  user_deactivated: 'User deactivated',
  user_export_override_changed: 'Export override changed',
  user_password_reset: 'Password reset',
  user_reactivated: 'User reactivated',
  user_role_changed: 'Role changed',
  user_updated: 'User updated',
}

export const AUDIT_ACTION_OPTIONS = auditEventTypes.map((eventType) => ({
  value: eventType,
  label: AUDIT_ACTION_LABELS[eventType] ?? eventType,
}))

export const formatAuditAction = (eventType: string) => {
  const mapped = AUDIT_ACTION_LABELS[eventType]
  if (mapped) {
    return mapped
  }

  const normalized = eventType
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  return normalized
    ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
    : 'Unknown action'
}

export const getAuditUserDisplay = (
  user: AuditUserSummary | null | undefined,
  userId: string | null | undefined,
  fallback: string,
): AuditUserDisplay => {
  const name = user?.name.trim()
  const email = user?.email.trim()
  const id = user?.id.trim() || userId?.trim()

  if (name) {
    return {
      label: name,
      detail: email || id,
    }
  }

  if (email) {
    return {
      label: email,
      detail: id,
    }
  }

  if (id) {
    return {
      label: id,
      detail: 'User not found',
    }
  }

  return {
    label: fallback,
  }
}

export const formatAuditTargetType = (
  targetType: AuditTargetType | null | undefined,
) => {
  if (targetType === 'batch') return 'Batch'
  if (targetType === 'document') return 'Document'
  if (targetType === 'user') return 'User'
  return 'System'
}

export const getAuditTargetDisplay = ({
  target,
  targetId,
  targetType,
  fallback = '—',
}: {
  target: AuditUserSummary | null | undefined
  targetId: string | null | undefined
  targetType: AuditTargetType | null | undefined
  fallback?: string
}): AuditTargetDisplay => {
  if (targetType === 'user') {
    return getAuditUserDisplay(target, targetId, fallback)
  }

  const id = targetId?.trim()
  if (id) {
    return {
      label: id,
      detail: formatAuditTargetType(targetType),
    }
  }

  if (targetType) {
    return {
      label: formatAuditTargetType(targetType),
      detail: 'No target ID',
    }
  }

  return {
    label: fallback,
  }
}
