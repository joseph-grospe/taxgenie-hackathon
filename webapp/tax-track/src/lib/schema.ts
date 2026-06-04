import {
  bigint,
  boolean,
  check,
  date,
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
import { sql } from 'drizzle-orm'

import type {
  SignaturePlacementTemplate,
  SignatureProfileView,
} from '@/lib/signing-module'
import type { AuditTargetType } from '@/lib/audit-types'

export { auditEventTypes, auditTargetTypes } from '@/lib/audit-types'
export type { AuditEventType, AuditTargetType } from '@/lib/audit-types'

export const authUserTable = pgTable(
  'user',
  {
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
    deletedAt: timestamp('deletedAt', { withTimezone: true }),
    deletedByUserId: text('deletedByUserId'),
    deletedReason: text('deletedReason'),
  },
  (table) => ({
    deletedAtIdx: index('user_deleted_at_idx').on(table.deletedAt),
  }),
)

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

export const securityAuditLogs = pgTable(
  'security_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurredAt', { withTimezone: true })
      .notNull()
      .defaultNow(),
    eventType: varchar('eventType', { length: 64 }).notNull(),
    actorUserId: text('actorUserId'),
    targetId: text('targetId'),
    targetType: varchar('targetType', { length: 16 }).$type<AuditTargetType>(),
    metadata: jsonb('metadata'),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
  },
  (table) => ({
    occurredAtIdx: index('security_audit_logs_occurred_at_idx').on(
      table.occurredAt,
    ),
    eventTypeIdx: index('security_audit_logs_event_type_idx').on(
      table.eventType,
    ),
    actorUserIdIdx: index('security_audit_logs_actor_user_id_idx').on(
      table.actorUserId,
    ),
    targetTypeIdx: index('security_audit_logs_target_type_idx').on(
      table.targetType,
    ),
  }),
)

export const intakeBatches = pgTable(
  'intake_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name'),
    entityId: integer('entity_id'),
    entityShortName: text('entity_short_name'),
    entityCompanyName: text('entity_company_name'),
    entityTin: text('entity_tin'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => authUserTable.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    totalFiles: integer('total_files').notNull().default(0),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: text('deleted_by_user_id').references(
      () => authUserTable.id,
      { onDelete: 'set null' },
    ),
    purgeAfterAt: timestamp('purge_after_at', { withTimezone: true }),
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
    activeLastActivityIdx: index('intake_batches_active_last_activity_idx')
      .on(table.lastActivityAt, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
    deletedAtIdx: index('intake_batches_deleted_at_idx').on(table.deletedAt),
    purgeAfterIdx: index('intake_batches_purge_after_idx')
      .on(table.purgeAfterAt)
      .where(sql`${table.deletedAt} is not null`),
    entityIdIdx: index('intake_batches_entity_id_idx').on(table.entityId),
    entityShortNameIdx: index('intake_batches_entity_short_name_idx').on(
      table.entityShortName,
    ),
    entityCompanyNameIdx: index('intake_batches_entity_company_name_idx').on(
      table.entityCompanyName,
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
    removedFromBatchByUserId: text('removed_from_batch_by_user_id').references(
      () => authUserTable.id,
      {
        onDelete: 'restrict',
      },
    ),
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
    dashboardUploadDateIdx: index('intake_files_dashboard_upload_date_idx')
      .using('btree', sql`(coalesce(${table.uploadedAt}, ${table.createdAt}))`)
      .where(sql`${table.removedFromBatchAt} is null`),
    dashboardUploadTypeDateIdx: index(
      'intake_files_dashboard_upload_type_date_idx',
    )
      .using(
        'btree',
        table.certificateDocumentType,
        sql`(coalesce(${table.uploadedAt}, ${table.createdAt}))`,
      )
      .where(sql`${table.removedFromBatchAt} is null`),
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

export const batchStageTimings = pgTable(
  'batch_stage_timings',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => intakeBatches.id, { onDelete: 'cascade' }),
    stage: varchar('stage', { length: 32 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    dedupeKey: varchar('dedupe_key', { length: 255 }),
    sourceType: varchar('source_type', { length: 64 }),
    sourceId: text('source_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    batchStageIdx: index('batch_stage_timings_batch_stage_idx').on(
      table.batchId,
      table.stage,
    ),
    dedupeKeyIdx: uniqueIndex('batch_stage_timings_dedupe_key_idx').on(
      table.dedupeKey,
    ),
    sourceIdx: index('batch_stage_timings_source_idx').on(
      table.sourceType,
      table.sourceId,
    ),
  }),
)

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
    originalFileName: text('original_file_name'),
    sourceHash: varchar('source_hash', { length: 64 }),
    dataFingerprint: varchar('data_fingerprint', { length: 64 }),
    periodEnd: date('period_end', { mode: 'string' }),
    payeeName: text('payee_name'),
    payeeTin: text('payee_tin'),
    payeeShortName: text('payee_short_name'),
    payorName: text('payor_name'),
    payorTin: text('payor_tin'),
    payorShortName: text('payor_short_name'),
    reasonCodes: jsonb('reason_codes'),
    payload: jsonb('payload').notNull(),
    validation: jsonb('validation').notNull(),
    artifactKey: text('artifact_key'),
    overrideStatus: varchar('override_status', { length: 16 }),
    overrideRequestId: uuid('override_request_id'),
    overriddenAt: timestamp('overridden_at', { withTimezone: true }),
    overriddenByUserId: text('overridden_by_user_id').references(
      () => authUserTable.id,
      { onDelete: 'restrict' },
    ),
    overridePatch: jsonb('override_patch').$type<Record<string, unknown>>(),
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
    payeeTinIdx: index('document_results_payee_tin_idx').on(table.payeeTin),
    payorTinIdx: index('document_results_payor_tin_idx').on(table.payorTin),
    payeeShortNameIdx: index('document_results_payee_short_name_idx').on(
      table.payeeShortName,
    ),
    payorShortNameIdx: index('document_results_payor_short_name_idx').on(
      table.payorShortName,
    ),
    uploadGuardIdx: uniqueIndex('document_results_upload_guard_idx').on(
      table.uploadId,
    ),
    dashboardStatusUploadIdx: index(
      'document_results_dashboard_status_upload_idx',
    ).on(table.status, table.uploadId),
  }),
)

export const certificateOverrideRequests = pgTable(
  'certificate_override_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentResultId: integer('document_result_id')
      .notNull()
      .references(() => documentResults.id, { onDelete: 'cascade' }),
    uploadId: uuid('upload_id')
      .notNull()
      .references(() => intakeFiles.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => intakeBatches.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    requestedByUserId: text('requested_by_user_id')
      .notNull()
      .references(() => authUserTable.id, { onDelete: 'restrict' }),
    requestNote: text('request_note').notNull(),
    correctedPayorTin: text('corrected_payor_tin'),
    correctedPayorName: text('corrected_payor_name'),
    resolvedMasterlistMatch: jsonb('resolved_masterlist_match').$type<
      Record<string, unknown>
    >(),
    originalValidation: jsonb('original_validation')
      .$type<Record<string, unknown>>()
      .notNull(),
    originalReasonCodes: jsonb('original_reason_codes').$type<
      Array<string>
    >(),
    decisionNote: text('decision_note'),
    decidedByUserId: text('decided_by_user_id').references(
      () => authUserTable.id,
      { onDelete: 'restrict' },
    ),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    documentResultIdx: index(
      'certificate_override_requests_document_result_idx',
    ).on(table.documentResultId),
    statusCreatedIdx: index(
      'certificate_override_requests_status_created_idx',
    ).on(table.status, table.createdAt),
    requestedByIdx: index(
      'certificate_override_requests_requested_by_idx',
    ).on(table.requestedByUserId, table.createdAt),
    pendingDocumentIdx: uniqueIndex(
      'certificate_override_requests_pending_document_idx',
    )
      .on(table.documentResultId)
      .where(sql`${table.status} = 'pending'`),
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
    firstDownloadedAt: timestamp('first_downloaded_at', {
      withTimezone: true,
    }),
    lastDownloadedAt: timestamp('last_downloaded_at', {
      withTimezone: true,
    }),
    downloadCount: integer('download_count').notNull().default(0),
    firstDownloadedByUserId: text('first_downloaded_by_user_id').references(
      () => authUserTable.id,
      { onDelete: 'set null' },
    ),
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
    firstDownloadedIdx: index(
      'certificate_signed_artifacts_first_downloaded_idx',
    )
      .on(table.firstDownloadedAt, table.documentResultId)
      .where(sql`${table.firstDownloadedAt} is not null`),
  }),
)

export const certificateMergeAssignments = pgTable(
  'certificate_merge_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentResultId: integer('document_result_id')
      .notNull()
      .references(() => documentResults.id, { onDelete: 'cascade' }),
    packageType: varchar('package_type', { length: 16 }).notNull(),
    sourceYear: integer('source_year').notNull(),
    sourceQuarter: integer('source_quarter'),
    assignedYear: integer('assigned_year'),
    assignedQuarter: integer('assigned_quarter'),
    status: varchar('status', { length: 32 }).notNull().default('assigned'),
    isLate: boolean('is_late').notNull().default(false),
    reason: text('reason').notNull().default('natural_period'),
    assignedByUserId: text('assigned_by_user_id').references(
      () => authUserTable.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    documentPackageUniqueIdx: uniqueIndex(
      'certificate_merge_assignments_document_package_idx',
    ).on(table.documentResultId, table.packageType),
    assignedPeriodIdx: index(
      'certificate_merge_assignments_assigned_period_idx',
    ).on(
      table.packageType,
      table.assignedYear,
      table.assignedQuarter,
      table.status,
    ),
    statusIdx: index('certificate_merge_assignments_status_idx').on(
      table.status,
    ),
  }),
)

export const certificateMergeJobs = pgTable(
  'certificate_merge_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => authUserTable.id, { onDelete: 'restrict' }),
    payeeShortName: text('payee_short_name').notNull(),
    entityTin: text('entity_tin').notNull(),
    periodType: varchar('period_type', { length: 16 }).notNull(),
    year: integer('year').notNull(),
    quarter: integer('quarter'),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    awsBatchJobId: text('aws_batch_job_id'),
    awsBatchStatus: varchar('aws_batch_status', { length: 32 }),
    totalInputFiles: integer('total_input_files').notNull().default(0),
    totalSizeBytes: bigint('total_size_bytes', { mode: 'number' })
      .notNull()
      .default(0),
    outputCount: integer('output_count').notNull().default(0),
    errorMessage: text('error_message'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
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
    createdByIdx: index('certificate_merge_jobs_created_by_idx').on(
      table.createdByUserId,
      table.createdAt,
    ),
    selectionIdx: index('certificate_merge_jobs_selection_idx').on(
      table.payeeShortName,
      table.periodType,
      table.year,
      table.quarter,
    ),
    batchJobIdx: index('certificate_merge_jobs_batch_job_idx').on(
      table.awsBatchJobId,
    ),
    statusIdx: index('certificate_merge_jobs_status_idx').on(table.status),
  }),
)

export const certificateMergeJobInputs = pgTable(
  'certificate_merge_job_inputs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    mergeJobId: uuid('merge_job_id')
      .notNull()
      .references(() => certificateMergeJobs.id, { onDelete: 'cascade' }),
    documentResultId: integer('document_result_id')
      .notNull()
      .references(() => documentResults.id, { onDelete: 'cascade' }),
    signedArtifactId: uuid('signed_artifact_id')
      .notNull()
      .references(() => certificateSignedArtifacts.id, {
        onDelete: 'cascade',
      }),
    signedPdfKey: text('signed_pdf_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    inputOrder: integer('input_order').notNull(),
    outputPartNumber: integer('output_part_number'),
    mergeAssignmentId: uuid('merge_assignment_id').references(
      () => certificateMergeAssignments.id,
      { onDelete: 'set null' },
    ),
    sourcePackageType: varchar('source_package_type', { length: 16 }),
    sourceYear: integer('source_year'),
    sourceQuarter: integer('source_quarter'),
    assignedYear: integer('assigned_year'),
    assignedQuarter: integer('assigned_quarter'),
    isLate: boolean('is_late').notNull().default(false),
    assignmentReason: text('assignment_reason'),
    originalFileName: text('original_file_name'),
    payorName: text('payor_name'),
    payeeTin: text('payee_tin'),
    periodEnd: date('period_end', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    mergeJobIdx: index('certificate_merge_job_inputs_job_idx').on(
      table.mergeJobId,
      table.inputOrder,
    ),
    documentResultIdx: index(
      'certificate_merge_job_inputs_document_result_idx',
    ).on(table.documentResultId),
    mergeDocumentUniqueIdx: uniqueIndex(
      'certificate_merge_job_inputs_job_document_idx',
    ).on(table.mergeJobId, table.documentResultId),
    outputPartIdx: index('certificate_merge_job_inputs_output_part_idx')
      .on(table.mergeJobId, table.outputPartNumber, table.documentResultId)
      .where(sql`${table.outputPartNumber} is not null`),
  }),
)

export const certificateMergeJobOutputs = pgTable(
  'certificate_merge_job_outputs',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    mergeJobId: uuid('merge_job_id')
      .notNull()
      .references(() => certificateMergeJobs.id, { onDelete: 'cascade' }),
    partNumber: integer('part_number').notNull(),
    fileName: text('file_name').notNull(),
    outputKey: text('output_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    inputCount: integer('input_count').notNull().default(0),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    etag: text('etag'),
    firstDownloadedAt: timestamp('first_downloaded_at', {
      withTimezone: true,
    }),
    lastDownloadedAt: timestamp('last_downloaded_at', {
      withTimezone: true,
    }),
    downloadCount: integer('download_count').notNull().default(0),
    firstDownloadedByUserId: text('first_downloaded_by_user_id').references(
      () => authUserTable.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    mergeJobIdx: index('certificate_merge_job_outputs_job_idx').on(
      table.mergeJobId,
      table.partNumber,
    ),
    mergePartUniqueIdx: uniqueIndex(
      'certificate_merge_job_outputs_job_part_idx',
    ).on(table.mergeJobId, table.partNumber),
    firstDownloadedIdx: index(
      'certificate_merge_job_outputs_first_downloaded_idx',
    )
      .on(table.firstDownloadedAt, table.mergeJobId, table.partNumber)
      .where(sql`${table.firstDownloadedAt} is not null`),
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

export const salesReports = pgTable(
  'sales_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: integer('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'restrict' }),
    entityShortName: text('entity_short_name'),
    entityCompanyName: text('entity_company_name'),
    entityTin: text('entity_tin').notNull(),
    name: text('name').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('uploading'),
    currentVersionId: uuid('current_version_id'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => authUserTable.id, { onDelete: 'restrict' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: text('deleted_by_user_id').references(
      () => authUserTable.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    entityStatusUpdatedIdx: index('sales_reports_entity_status_updated_idx').on(
      table.entityId,
      table.status,
      table.updatedAt,
    ),
    createdByUpdatedIdx: index('sales_reports_created_by_updated_idx').on(
      table.createdByUserId,
      table.updatedAt,
    ),
    deletedAtIdx: index('sales_reports_deleted_at_idx').on(table.deletedAt),
  }),
)

export const salesReportVersions = pgTable(
  'sales_report_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesReportId: uuid('sales_report_id')
      .notNull()
      .references(() => salesReports.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
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
    parseStatus: varchar('parse_status', { length: 32 })
      .notNull()
      .default('pending'),
    rowCount: integer('row_count').notNull().default(0),
    errorMessage: text('error_message'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    parsedAt: timestamp('parsed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    reportVersionUniqueIdx: uniqueIndex(
      'sales_report_versions_report_version_idx',
    ).on(table.salesReportId, table.versionNumber),
    reportCreatedIdx: index('sales_report_versions_report_created_idx').on(
      table.salesReportId,
      table.createdAt,
    ),
    parseStatusIdx: index('sales_report_versions_parse_status_idx').on(
      table.parseStatus,
    ),
  }),
)

export const salesReportRows = pgTable(
  'sales_report_rows',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    salesReportVersionId: uuid('sales_report_version_id')
      .notNull()
      .references(() => salesReportVersions.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    versionRowUniqueIdx: uniqueIndex('sales_report_rows_version_row_idx').on(
      table.salesReportVersionId,
      table.rowNumber,
    ),
    versionIdx: index('sales_report_rows_version_idx').on(
      table.salesReportVersionId,
    ),
    tinIdx: index('sales_report_rows_tin_idx').on(table.tin),
    invoiceIdx: index('sales_report_rows_invoice_idx').on(table.invoiceNumber),
    customerIdx: index('sales_report_rows_customer_idx').on(table.customerName),
  }),
)

export const salesReportRuns = pgTable(
  'sales_report_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesReportId: uuid('sales_report_id')
      .notNull()
      .references(() => salesReports.id, { onDelete: 'cascade' }),
    salesReportVersionId: uuid('sales_report_version_id')
      .notNull()
      .references(() => salesReportVersions.id, { onDelete: 'restrict' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => authUserTable.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 32 }).notNull().default('running'),
    selectedBatchCount: integer('selected_batch_count').notNull().default(0),
    totalRows: integer('total_rows').notNull().default(0),
    matchedCount: integer('matched_count').notNull().default(0),
    unmatchedCount: integer('unmatched_count').notNull().default(0),
    varianceTotal: doublePrecision('variance_total').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByUserId: text('archived_by_user_id').references(
      () => authUserTable.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    reportStatusCreatedIdx: index(
      'sales_report_runs_report_status_created_idx',
    ).on(table.salesReportId, table.status, table.createdAt),
    activeReportIdx: index('sales_report_runs_active_report_idx')
      .on(table.salesReportId, table.createdAt)
      .where(sql`${table.archivedAt} is null`),
  }),
)

export const salesReportRunBatches = pgTable(
  'sales_report_run_batches',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    salesReportRunId: uuid('sales_report_run_id')
      .notNull()
      .references(() => salesReportRuns.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => intakeBatches.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    runBatchUniqueIdx: uniqueIndex('sales_report_run_batches_run_batch_idx').on(
      table.salesReportRunId,
      table.batchId,
    ),
    batchIdx: index('sales_report_run_batches_batch_idx').on(table.batchId),
  }),
)

export const atcCodes = pgTable(
  'atc_codes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    taxType: text('tax_type').notNull(),
    code: varchar('code', { length: 32 }).notNull(),
    description: text('description').notNull(),
    rate: doublePrecision('rate').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    codeUniqueIdx: uniqueIndex('atc_codes_code_idx').on(table.code),
    codeNormalizedCheck: check(
      'atc_codes_code_normalized_check',
      sql`${table.code} = regexp_replace(upper(trim(${table.code})), '[^A-Z0-9]', '', 'g') and length(${table.code}) > 0`,
    ),
    ratePositiveCheck: check(
      'atc_codes_rate_positive_check',
      sql`${table.rate} > 0`,
    ),
  }),
)

export const reconciliationResults = pgTable(
  'reconciliation_results',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    uploadBatchId: uuid('upload_batch_id'),
    salesReportId: uuid('sales_report_id').references(() => salesReports.id, {
      onDelete: 'set null',
    }),
    salesReportVersionId: uuid('sales_report_version_id').references(
      () => salesReportVersions.id,
      { onDelete: 'set null' },
    ),
    salesReportRunId: uuid('sales_report_run_id').references(
      () => salesReportRuns.id,
      { onDelete: 'set null' },
    ),
    salesReportRowId: integer('sales_report_row_id').references(
      () => salesReportRows.id,
      { onDelete: 'set null' },
    ),
    matchedUploadBatchId: uuid('matched_upload_batch_id').references(
      () => intakeBatches.id,
      { onDelete: 'set null' },
    ),
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
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    emailSentAt: timestamp('email_sent_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByUserId: text('archived_by_user_id').references(
      () => authUserTable.id,
      { onDelete: 'set null' },
    ),
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
    matchedAtIdx: index('reconciliation_results_matched_at_idx').on(
      table.matchedAt,
    ),
    requestingEntityShortNameIdx: index(
      'reconciliation_results_requesting_entity_short_name_idx',
    ).on(table.requestingEntityShortName),
    salesReportActiveIdx: index(
      'reconciliation_results_sales_report_active_idx',
    )
      .on(table.salesReportId, table.salesReportRunId, table.createdAt)
      .where(sql`${table.archivedAt} is null`),
    salesReportRunIdx: index('reconciliation_results_sales_report_run_idx').on(
      table.salesReportRunId,
    ),
    salesReportRowIdx: index('reconciliation_results_sales_report_row_idx').on(
      table.salesReportRowId,
    ),
    matchedUploadBatchIdx: index(
      'reconciliation_results_matched_upload_batch_idx',
    ).on(table.matchedUploadBatchId),
    archivedAtIdx: index('reconciliation_results_archived_at_idx').on(
      table.archivedAt,
    ),
    dashboardUnmatchedCreatedIdx: index(
      'reconciliation_results_dashboard_unmatched_created_idx',
    )
      .on(table.createdAt)
      .where(sql`${table.matchedTaxRecordId} is null`),
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
  batchStageTimings,
  documentResults,
  certificateOverrideRequests,
  certificateSignedArtifacts,
  certificateMergeAssignments,
  certificateMergeJobs,
  certificateMergeJobInputs,
  certificateMergeJobOutputs,
  masterlist,
  entities,
  salesReports,
  salesReportVersions,
  salesReportRows,
  salesReportRuns,
  salesReportRunBatches,
  atcCodes,
  reconciliationResults,
}

export type AuthTables = Pick<
  typeof schema,
  'user' | 'session' | 'account' | 'verification'
>
export type SecurityAuditLogRecord = typeof securityAuditLogs.$inferSelect
export type SecurityAuditLogInsert = typeof securityAuditLogs.$inferInsert
