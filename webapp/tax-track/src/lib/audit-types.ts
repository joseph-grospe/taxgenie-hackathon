export const auditEventTypes = [
  'user_created',
  'user_deleted',
  'user_updated',
  'user_deactivated',
  'user_reactivated',
  'user_password_reset',
  'user_verification_email_resent',
  'user_role_changed',
  'user_export_override_changed',
  'signature_profile_updated',
  'certificate_signed',
  'certificate_resigned',
  'certificate_sign_failed',
  'certificate_override_requested',
  'certificate_override_approved',
  'certificate_override_rejected',
  'password_changed_first_login',
  'password_changed_self',
  'login_failed',
  'login_succeeded',
  'dev_data_reset',
  'audit_exported',
  'issues_exported',
  'document_extraction_retried',
  'batch_deleted',
  'batch_purge_requested',
  'batch_restored',
  'batch_purged',
  'document_purge_requested',
  'document_purged',
  'reference_data_imported',
  'reference_data_row_created',
  'reference_data_row_updated',
  'reference_data_row_deleted',
] as const

export type AuditEventType = (typeof auditEventTypes)[number]

export const auditTargetTypes = [
  'user',
  'batch',
  'document',
  'reference_data',
] as const

export type AuditTargetType = (typeof auditTargetTypes)[number]

export const isAuditEventType = (value: unknown): value is AuditEventType =>
  typeof value === 'string' && auditEventTypes.includes(value as AuditEventType)

export const isAuditTargetType = (value: unknown): value is AuditTargetType =>
  typeof value === 'string' &&
  auditTargetTypes.includes(value as AuditTargetType)
