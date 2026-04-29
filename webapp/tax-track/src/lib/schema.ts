import { sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import type {
  SignaturePlacementTemplate,
  SignatureProfileView,
} from '@/lib/signing-module'

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
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt', {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', {
    withTimezone: true,
  }),
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

export const userSignatureProfiles = pgTable('user_signature_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => authUserTable.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  designation: text('designation').notNull(),
  tin: text('tin').notNull(),
  signatureImageKey: text('signature_image_key').notNull(),
  signatureImageMimeType: varchar('signature_image_mime_type', {
    length: 32,
  }).notNull(),
  signatureImageWidth: integer('signature_image_width').notNull(),
  signatureImageHeight: integer('signature_image_height').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export const certificateSignatureTemplates = pgTable(
  'certificate_signature_templates',
  {
    templateKey: text('template_key').primaryKey(),
    pageNumber: integer('page_number').notNull().default(1),
    signatureRect: jsonb('signature_rect')
      .$type<SignaturePlacementTemplate['signatureRect']>()
      .notNull(),
    nameRect: jsonb('name_rect')
      .$type<SignaturePlacementTemplate['nameRect']>()
      .notNull(),
    designationRect: jsonb('designation_rect')
      .$type<SignaturePlacementTemplate['designationRect']>()
      .notNull(),
    tinRect: jsonb('tin_rect')
      .$type<SignaturePlacementTemplate['tinRect']>()
      .notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => authUserTable.id, { onDelete: 'restrict' }),
    updatedByUserId: text('updated_by_user_id')
      .notNull()
      .references(() => authUserTable.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
)

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

export const intakeBatches = pgTable(
  'intake_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => authUserTable.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    totalFiles: integer('total_files').notNull().default(0),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    createdByStatusIdx: index('intake_batches_created_by_status_idx').on(
      table.createdByUserId,
      table.status,
    ),
    lastActivityIdx: index('intake_batches_last_activity_idx').on(
      table.lastActivityAt,
    ),
  }),
)

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
    certificateDocumentType: varchar('certificate_document_type', {
      length: 32,
    }),
    certificateIssuerShortName: text('certificate_issuer_short_name'),
    certificateIssuerShortNameNormalized: text(
      'certificate_issuer_short_name_normalized',
    ),
    certificateRecipientShortName: text('certificate_recipient_short_name'),
    certificateSettlementReferenceNumber: text(
      'certificate_settlement_reference_number',
    ),
    certificateBillingMonthMMYY: varchar('certificate_billing_month_mmyy', {
      length: 4,
    }),
    certificateDateUploaded: varchar('certificate_date_uploaded', {
      length: 8,
    }),
    uploadStatus: varchar('upload_status', { length: 32 })
      .notNull()
      .default('pending'),
    queueStatus: varchar('queue_status', { length: 32 })
      .notNull()
      .default('pending'),
    processingStatus: varchar('processing_status', { length: 32 })
      .notNull()
      .default('pending'),
    attentionStatus: varchar('attention_status', { length: 32 })
      .notNull()
      .default('open'),
    attentionResolvedAt: timestamp('attention_resolved_at', {
      withTimezone: true,
    }),
    attentionResolvedByUserId: text('attention_resolved_by_user_id').references(
      () => authUserTable.id,
      { onDelete: 'restrict' },
    ),
    removedFromBatchAt: timestamp('removed_from_batch_at', {
      withTimezone: true,
    }),
    removedFromBatchByUserId: text(
      'removed_from_batch_by_user_id',
    ).references(() => authUserTable.id, {
      onDelete: 'restrict',
    }),
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
    batchRemovedIdx: index('intake_files_batch_removed_idx').on(
      table.batchId,
      table.removedFromBatchAt,
    ),
    eventIdIdx: index('intake_files_event_id_idx').on(table.eventId),
    originalFileNameIdx: index('intake_files_original_file_name_idx').on(
      table.originalFileName,
    ),
    sourceFileRevisionIdx: index('intake_files_source_file_revision_idx').on(
      table.sourceFileId,
      table.revision,
    ),
    certificateIssuerBillingMonthIdx: index(
      'intake_files_certificate_issuer_billing_month_idx',
    ).on(
      table.certificateIssuerShortNameNormalized,
      table.certificateBillingMonthMMYY,
      table.uploadedAt,
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
    documentKind: varchar('document_kind', { length: 32 })
      .notNull()
      .default('upload'),
    pageNumber: integer('page_number'),
    outcome: varchar('outcome', { length: 32 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    finalKey: text('final_key'),
    originalFileName: text('original_file_name'),
    sourceHash: varchar('source_hash', { length: 64 }),
    dataFingerprint: varchar('data_fingerprint', { length: 64 }),
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
    sourceFileRevisionIdx: index(
      'document_results_source_file_revision_idx',
    ).on(table.sourceFileId, table.revision),
    outcomeIdx: index('document_results_outcome_idx').on(table.outcome),
    originalFileNameIdx: index('document_results_original_file_name_idx').on(
      table.originalFileName,
    ),
    sourceHashIdx: index('document_results_source_hash_idx').on(
      table.sourceHash,
    ),
    dataFingerprintIdx: index('document_results_data_fingerprint_idx').on(
      table.dataFingerprint,
    ),
    uploadKindPageIdx: uniqueIndex(
      'document_results_upload_kind_page_guard_idx',
    ).on(
      table.uploadId,
      table.documentKind,
      sql`COALESCE(${table.pageNumber}, -1)`,
    ),
  }),
)

export const certificateSignedArtifacts = pgTable(
  'certificate_signed_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentResultId: integer('document_result_id')
      .notNull()
      .references(() => documentResults.id, { onDelete: 'cascade' }),
    signedByUserId: text('signed_by_user_id')
      .notNull()
      .references(() => authUserTable.id, { onDelete: 'restrict' }),
    signatureProfileSnapshot: jsonb('signature_profile_snapshot')
      .$type<Omit<SignatureProfileView, 'signatureImageUrl' | 'updatedAt'>>()
      .notNull(),
    placementSnapshot: jsonb('placement_snapshot')
      .$type<SignaturePlacementTemplate>()
      .notNull(),
    sourcePdfKey: text('source_pdf_key').notNull(),
    signedPdfKey: text('signed_pdf_key'),
    status: varchar('status', { length: 32 }).notNull().default('signed'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    documentResultUniqueIdx: uniqueIndex(
      'certificate_signed_artifacts_document_result_idx',
    ).on(table.documentResultId),
    signerIdx: index('certificate_signed_artifacts_signer_idx').on(
      table.signedByUserId,
    ),
  }),
)

export const masterlist = pgTable('masterlist', {
  region: text('region'),
  entity: text('entity'),
  shortName: text('short_name'),
  customerName: text('customer_name'),
  tin: text('tin'),
  address: text('address'),
  emailAddress: text('email_address'),
})

export const entities = pgTable('entities', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  shortName: text('short_name'),
  companyName: text('company_name'),
  birRegisteredAddress: text('bir_registered_address'),
  zipCode: text('zip_code'),
  tin: text('tin'),
  emailAddress: text('email_address'),
  regionEmailAddress: text('region_email_address'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const reconciliationResults = pgTable(
  'reconciliation_results',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    uploadBatchId: uuid('upload_batch_id').notNull(),
    requestingEntityShortName: text('requesting_entity_short_name'),
    customerName: text('customer_name').notNull(),
    tin: text('tin').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    accountingDate: text('accounting_date'),
    transactionLineDescription: text('transaction_line_description').notNull(),
    taxableSales: doublePrecision('taxable_sales').notNull(),
    outputVAT: doublePrecision('output_vat').notNull(),
    prepaidCWT: doublePrecision('prepaid_cwt').notNull(),
    issuerShortnameUsedForMatch: text(
      'issuer_shortname_used_for_match',
    ).notNull(),
    derivedBillingMonthMMYY: varchar('derived_billing_month_mmyy', {
      length: 4,
    }).notNull(),
    matchedTaxRecordId: integer('matched_tax_record_id').references(
      () => documentResults.id,
      { onDelete: 'set null' },
    ),
    taxBase: doublePrecision('tax_base'),
    taxWithheld: doublePrecision('tax_withheld'),
    taxBaseDifference: doublePrecision('tax_base_difference').notNull(),
    taxWithheldDifference: doublePrecision('tax_withheld_difference').notNull(),
    hasDifference: boolean('has_difference').notNull(),
    matchStatus: varchar('match_status', { length: 32 }).notNull(),
    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    uploadBatchIdx: index('reconciliation_results_upload_batch_idx').on(
      table.uploadBatchId,
    ),
    matchedTaxRecordIdx: index(
      'reconciliation_results_matched_tax_record_idx',
    ).on(table.matchedTaxRecordId),
    createdAtIdx: index('reconciliation_results_created_at_idx').on(
      table.createdAt,
    ),
  }),
)

export const schema = {
  user: authUserTable,
  session: authSessionTable,
  account: authAccountTable,
  verification: authVerificationTable,
  userSignatureProfiles,
  certificateSignatureTemplates,
  securityAuditLogs,
  intakeBatches,
  intakeFiles,
  workerJobs,
  workerJobSteps,
  workerIdempotency,
  documentResults,
  certificateSignedArtifacts,
  masterlist,
  entities,
  reconciliationResults,
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
  'signature_profile_updated',
  'certificate_signed',
  'certificate_resigned',
  'certificate_sign_failed',
  'password_changed_first_login',
  'password_changed_self',
  'login_failed',
  'login_succeeded',
] as const

export type AuditEventType = (typeof auditEventTypes)[number]
