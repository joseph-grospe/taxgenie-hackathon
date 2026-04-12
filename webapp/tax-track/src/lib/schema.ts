import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  index,
} from 'drizzle-orm/pg-core'

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

export const intakeBatches = pgTable('intake_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdByUserId: text('created_by_user_id')
    .notNull()
    .references(() => authUserTable.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  totalFiles: integer('total_files').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const intakeFiles = pgTable(
  'intake_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => intakeBatches.id, { onDelete: 'cascade' }),
    uploadedByUserId: text('uploaded_by_user_id')
      .notNull()
      .references(() => authUserTable.id, { onDelete: 'restrict' }),
    originalFileName: text('original_file_name').notNull(),
    sanitizedFileName: text('sanitized_file_name').notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageBucket: text('storage_bucket').notNull(),
    storageKey: text('storage_key').notNull(),
    artifactUri: text('artifact_uri'),
    sourceFileId: varchar('source_file_id', { length: 255 }),
    revision: varchar('revision', { length: 255 }),
    eventId: varchar('event_id', { length: 255 }),
    traceId: varchar('trace_id', { length: 255 }),
    queueMessageId: varchar('queue_message_id', { length: 255 }),
    uploadStatus: varchar('upload_status', { length: 32 })
      .notNull()
      .default('pending'),
    queueStatus: varchar('queue_status', { length: 32 })
      .notNull()
      .default('pending'),
    processingStatus: varchar('processing_status', { length: 32 })
      .notNull()
      .default('pending'),
    currentPhase: varchar('current_phase', { length: 32 }),
    currentStep: varchar('current_step', { length: 128 }),
    errorMessage: text('error_message'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    queuedAt: timestamp('queued_at', { withTimezone: true }),
    processingStartedAt: timestamp('processing_started_at', {
      withTimezone: true,
    }),
    processingFinishedAt: timestamp('processing_finished_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    batchIdx: index('intake_files_batch_idx').on(table.batchId),
    eventIdIdx: index('intake_files_event_id_idx').on(table.eventId),
    sourceFileRevisionIdx: index('intake_files_source_file_revision_idx').on(
      table.sourceFileId,
      table.revision,
    ),
  }),
)

export const workerJobs = pgTable(
  'worker_jobs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    jobId: varchar('job_id', { length: 128 }).notNull().unique(),
    eventId: varchar('event_id', { length: 255 }).notNull(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => intakeBatches.id, { onDelete: 'cascade' }),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => intakeFiles.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 32 }).notNull(),
    originalFileName: text('original_file_name').notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    currentPhase: varchar('current_phase', { length: 32 }),
    currentStep: varchar('current_step', { length: 128 }),
    attempts: integer('attempts').notNull().default(0),
    errorSummary: text('error_summary'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    batchIdx: index('worker_jobs_batch_idx').on(table.batchId),
    uploadIdx: index('worker_jobs_upload_idx').on(table.uploadId),
    eventIdx: index('worker_jobs_event_idx').on(table.eventId),
  }),
)

export const workerJobSteps = pgTable(
  'worker_job_steps',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    jobId: varchar('job_id', { length: 128 }).notNull(),
    stepName: varchar('step_name', { length: 128 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    durationMs: integer('duration_ms'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    jobIdx: index('worker_job_steps_job_idx').on(table.jobId),
  }),
)

export const workerIdempotency = pgTable('worker_idempotency', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  idempotencyKey: varchar('idempotency_key', { length: 255 })
    .notNull()
    .unique(),
  jobId: varchar('job_id', { length: 128 }),
  terminalState: varchar('terminal_state', { length: 32 })
    .notNull()
    .default('pending'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const documentResults = pgTable(
  'document_results',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    jobId: varchar('job_id', { length: 128 }).notNull(),
    eventId: varchar('event_id', { length: 255 }).notNull(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => intakeBatches.id, { onDelete: 'cascade' }),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => intakeFiles.id, { onDelete: 'cascade' }),
    sourceFileId: varchar('source_file_id', { length: 255 }).notNull(),
    revision: varchar('revision', { length: 128 }).notNull(),
    outcome: varchar('outcome', { length: 32 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    finalKey: text('final_key'),
    reasonCodes: jsonb('reason_codes'),
    payload: jsonb('payload').notNull(),
    validation: jsonb('validation').notNull(),
    artifactKey: text('artifact_key'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    batchIdx: index('document_results_batch_idx').on(table.batchId),
    uploadIdx: index('document_results_upload_idx').on(table.uploadId),
    sourceFileRevisionIdx: index('document_results_source_file_revision_idx').on(
      table.sourceFileId,
      table.revision,
    ),
    outcomeIdx: index('document_results_outcome_idx').on(table.outcome),
  }),
)

export const schema = {
  user: authUserTable,
  session: authSessionTable,
  account: authAccountTable,
  verification: authVerificationTable,
  securityAuditLogs,
  intakeBatches,
  intakeFiles,
  workerJobs,
  workerJobSteps,
  workerIdempotency,
  documentResults,
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
