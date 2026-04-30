import {
  date,
  integer,
  jsonb,
  index,
  pgTable,
  uniqueIndex,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const intakeBatches = pgTable(
  "intake_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdByUserId: text("created_by_user_id").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    totalFiles: integer("total_files").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    createdByStatusIdx: index("intake_batches_created_by_status_idx").on(
      table.createdByUserId,
      table.status,
    ),
    lastActivityIdx: index("intake_batches_last_activity_idx").on(
      table.lastActivityAt,
    ),
  }),
);

export const intakeFiles = pgTable(
  "intake_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => intakeBatches.id, { onDelete: "cascade" }),
    uploadedByUserId: text("uploaded_by_user_id").notNull(),
    originalFileName: text("original_file_name").notNull(),
    sanitizedFileName: text("sanitized_file_name").notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageBucket: text("storage_bucket").notNull(),
    storageKey: text("storage_key").notNull(),
    artifactUri: text("artifact_uri"),
    sourceFileId: varchar("source_file_id", { length: 255 }),
    revision: varchar("revision", { length: 255 }),
    eventId: varchar("event_id", { length: 255 }),
    traceId: varchar("trace_id", { length: 255 }),
    queueMessageId: varchar("queue_message_id", { length: 255 }),
    certificateDocumentType: varchar("certificate_document_type", {
      length: 32,
    }),
    certificateIssuerShortName: text("certificate_issuer_short_name"),
    certificateIssuerShortNameNormalized: text(
      "certificate_issuer_short_name_normalized",
    ),
    certificateRecipientShortName: text("certificate_recipient_short_name"),
    certificateSettlementReferenceNumber: text(
      "certificate_settlement_reference_number",
    ),
    certificateBillingMonthMMYY: varchar("certificate_billing_month_mmyy", {
      length: 4,
    }),
    certificateDateUploaded: varchar("certificate_date_uploaded", {
      length: 8,
    }),
    uploadStatus: varchar("upload_status", { length: 32 })
      .notNull()
      .default("pending"),
    queueStatus: varchar("queue_status", { length: 32 })
      .notNull()
      .default("pending"),
    processingStatus: varchar("processing_status", { length: 32 })
      .notNull()
      .default("pending"),
    removedFromBatchAt: timestamp("removed_from_batch_at", {
      withTimezone: true,
    }),
    removedFromBatchByUserId: text("removed_from_batch_by_user_id"),
    currentPhase: varchar("current_phase", { length: 32 }),
    currentStep: varchar("current_step", { length: 128 }),
    errorMessage: text("error_message"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }),
    processingFinishedAt: timestamp("processing_finished_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    batchIdx: index("intake_files_batch_idx").on(table.batchId),
    batchRemovedIdx: index("intake_files_batch_removed_idx").on(
      table.batchId,
      table.removedFromBatchAt,
    ),
    eventIdIdx: index("intake_files_event_id_idx").on(table.eventId),
    originalFileNameIdx: index("intake_files_original_file_name_idx").on(
      table.originalFileName,
    ),
    sourceFileRevisionIdx: index("intake_files_source_file_revision_idx").on(
      table.sourceFileId,
      table.revision,
    ),
    certificateIssuerBillingMonthIdx: index(
      "intake_files_certificate_issuer_billing_month_idx",
    ).on(
      table.certificateIssuerShortNameNormalized,
      table.certificateBillingMonthMMYY,
      table.uploadedAt,
    ),
  }),
);

export const workerJobs = pgTable(
  "worker_jobs",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    jobId: varchar("job_id", { length: 128 }).notNull().unique(),
    eventId: varchar("event_id", { length: 255 }).notNull(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => intakeBatches.id, { onDelete: "cascade" }),
    uploadId: uuid("upload_id").notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    originalFileName: text("original_file_name").notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    currentPhase: varchar("current_phase", { length: 32 }),
    currentStep: varchar("current_step", { length: 128 }),
    attempts: integer("attempts").notNull().default(0),
    errorSummary: text("error_summary"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    batchIdx: index("worker_jobs_batch_idx").on(table.batchId),
    uploadIdx: index("worker_jobs_upload_idx").on(table.uploadId),
    eventIdx: index("worker_jobs_event_idx").on(table.eventId),
  }),
);

export const workerJobSteps = pgTable(
  "worker_job_steps",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    jobId: varchar("job_id", { length: 128 }).notNull(),
    stepName: varchar("step_name", { length: 128 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    jobIdx: index("worker_job_steps_job_idx").on(table.jobId),
  }),
);

export const workerIdempotency = pgTable("worker_idempotency", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  idempotencyKey: varchar("idempotency_key", { length: 255 })
    .notNull()
    .unique(),
  jobId: varchar("job_id", { length: 128 }),
  terminalState: varchar("terminal_state", { length: 32 })
    .notNull()
    .default("pending"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documentResults = pgTable(
  "document_results",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    jobId: varchar("job_id", { length: 128 }).notNull(),
    eventId: varchar("event_id", { length: 255 }).notNull(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => intakeBatches.id, { onDelete: "cascade" }),
    uploadId: uuid("upload_id").notNull(),
    sourceFileId: varchar("source_file_id", { length: 255 }).notNull(),
    revision: varchar("revision", { length: 128 }).notNull(),
    outcome: varchar("outcome", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    finalKey: text("final_key"),
    originalFileName: text("original_file_name"),
    sourceHash: varchar("source_hash", { length: 64 }),
    dataFingerprint: varchar("data_fingerprint", { length: 64 }),
    periodEnd: date("period_end", { mode: "string" }),
    payeeName: text("payee_name"),
    payeeTin: text("payee_tin"),
    payeeShortName: text("payee_short_name"),
    payorName: text("payor_name"),
    payorTin: text("payor_tin"),
    payorShortName: text("payor_short_name"),
    reasonCodes: jsonb("reason_codes"),
    payload: jsonb("payload").notNull(),
    validation: jsonb("validation").notNull(),
    artifactKey: text("artifact_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    batchIdx: index("document_results_batch_idx").on(table.batchId),
    uploadIdx: index("document_results_upload_idx").on(table.uploadId),
    sourceFileRevisionIdx: index(
      "document_results_source_file_revision_idx",
    ).on(table.sourceFileId, table.revision),
    outcomeIdx: index("document_results_outcome_idx").on(table.outcome),
    originalFileNameIdx: index("document_results_original_file_name_idx").on(
      table.originalFileName,
    ),
    sourceHashIdx: index("document_results_source_hash_idx").on(
      table.sourceHash,
    ),
    dataFingerprintIdx: index("document_results_data_fingerprint_idx").on(
      table.dataFingerprint,
    ),
    payeeTinIdx: index("document_results_payee_tin_idx").on(table.payeeTin),
    payorTinIdx: index("document_results_payor_tin_idx").on(table.payorTin),
    payeeShortNameIdx: index("document_results_payee_short_name_idx").on(
      table.payeeShortName,
    ),
    payorShortNameIdx: index("document_results_payor_short_name_idx").on(
      table.payorShortName,
    ),
    uploadGuardIdx: uniqueIndex("document_results_upload_guard_idx").on(
      table.uploadId,
    ),
  }),
);

export const masterlist = pgTable("masterlist", {
  region: text("region"),
  entity: text("entity"),
  shortName: text("short_name"),
  customerName: text("customer_name"),
  tin: text("tin"),
  address: text("address"),
  emailAddress: text("email_address"),
});

export const entities = pgTable("entities", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  shortName: text("short_name"),
  companyName: text("company_name"),
  birRegisteredAddress: text("bir_registered_address"),
  zipCode: text("zip_code"),
  tin: text("tin"),
  emailAddress: text("email_address"),
  regionEmailAddress: text("region_email_address"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
