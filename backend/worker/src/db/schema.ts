import {
  integer,
  jsonb,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const intakeBatches = pgTable("intake_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdByUserId: text("created_by_user_id").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  totalFiles: integer("total_files").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const intakeFiles = pgTable(
  "intake_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull(),
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
    certificateDocumentType: varchar("certificate_document_type", { length: 32 }),
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
    uploadStatus: varchar("upload_status", { length: 32 }).notNull().default("pending"),
    queueStatus: varchar("queue_status", { length: 32 }).notNull().default("pending"),
    processingStatus: varchar("processing_status", { length: 32 }).notNull().default("pending"),
    currentPhase: varchar("current_phase", { length: 32 }),
    currentStep: varchar("current_step", { length: 128 }),
    errorMessage: text("error_message"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    processingFinishedAt: timestamp("processing_finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchIdx: index("intake_files_batch_idx").on(table.batchId),
    eventIdIdx: index("intake_files_event_id_idx").on(table.eventId),
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
    batchId: uuid("batch_id").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    jobIdx: index("worker_job_steps_job_idx").on(table.jobId),
  }),
);

export const workerIdempotency = pgTable("worker_idempotency", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
  jobId: varchar("job_id", { length: 128 }),
  terminalState: varchar("terminal_state", { length: 32 }).notNull().default("pending"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentResults = pgTable(
  "document_results",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    jobId: varchar("job_id", { length: 128 }).notNull(),
    eventId: varchar("event_id", { length: 255 }).notNull(),
    batchId: uuid("batch_id").notNull(),
    uploadId: uuid("upload_id").notNull(),
    sourceFileId: varchar("source_file_id", { length: 255 }).notNull(),
    revision: varchar("revision", { length: 128 }).notNull(),
    outcome: varchar("outcome", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    finalKey: text("final_key"),
    reasonCodes: jsonb("reason_codes"),
    payload: jsonb("payload").notNull(),
    validation: jsonb("validation").notNull(),
    artifactKey: text("artifact_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchIdx: index("document_results_batch_idx").on(table.batchId),
    uploadIdx: index("document_results_upload_idx").on(table.uploadId),
    sourceFileRevisionIdx: index("document_results_source_file_revision_idx").on(
      table.sourceFileId,
      table.revision,
    ),
    outcomeIdx: index("document_results_outcome_idx").on(table.outcome),
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
