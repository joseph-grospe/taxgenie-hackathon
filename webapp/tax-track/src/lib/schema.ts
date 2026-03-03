import { boolean, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const authUserTable = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  team: text('team').notNull().default('it'),
  mustChangePassword: boolean('mustChangePassword').notNull().default(false),
  canExportPdf: boolean('canExportPdf').notNull().default(false),
  canExportExcel: boolean('canExportExcel').notNull().default(false),
  role: text('role'),
  banned: boolean('banned').notNull().default(false),
  banReason: text('banReason'),
  banExpires: timestamp('banExpires', { withTimezone: true }),
})

export const authSessionTable = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => authUserTable.id, { onDelete: 'cascade' }),
  impersonatedBy: text('impersonatedBy'),
})

export const authAccountTable = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => authUserTable.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const authVerificationTable = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const securityAuditLogs = pgTable('security_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurredAt', { withTimezone: true })
    .notNull()
    .defaultNow(),
  eventType: varchar('eventType', { length: 64 }).notNull(),
  actorUserId: text('actorUserId'),
  targetUserId: text('targetUserId'),
  metadata: jsonb('metadata'),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
})

export const schema = {
  user: authUserTable,
  session: authSessionTable,
  account: authAccountTable,
  verification: authVerificationTable,
  securityAuditLogs,
}

export type AuthTables = Pick<
  typeof schema,
  'user' | 'session' | 'account' | 'verification'
>
export type SecurityAuditLogRecord = typeof securityAuditLogs.$inferSelect
export type SecurityAuditLogInsert = typeof securityAuditLogs.$inferInsert

export const auditEventTypes = [
  'user_created',
  'user_updated',
  'user_deactivated',
  'user_reactivated',
  'user_password_reset',
  'user_role_changed',
  'user_export_override_changed',
  'password_changed_first_login',
  'password_changed_self',
  'login_failed',
  'login_succeeded',
] as const

export type AuditEventType = (typeof auditEventTypes)[number]
