export const auditEventTypes = [
  'user_created',
  'user_updated',
  'user_deactivated',
  'user_reactivated',
  'user_password_reset',
  'user_role_changed',
  'user_export_override_changed',
  'signature_profile_updated',
  'certificate_signed',
  'certificate_resigned',
  'certificate_sign_failed',
  'password_changed_first_login',
  'password_changed_self',
  'login_failed',
  'login_succeeded',
  'dev_data_reset',
] as const

export type AuditEventType = (typeof auditEventTypes)[number]

export const auditTargetTypes = ['user', 'batch', 'document'] as const

export type AuditTargetType = (typeof auditTargetTypes)[number]

export const isAuditEventType = (value: unknown): value is AuditEventType =>
  typeof value === 'string' && auditEventTypes.includes(value as AuditEventType)

export const isAuditTargetType = (value: unknown): value is AuditTargetType =>
  typeof value === 'string' &&
  auditTargetTypes.includes(value as AuditTargetType)
