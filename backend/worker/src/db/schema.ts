import {
  integer,
  jsonb,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  varchar
} from "drizzle-orm/pg-core";

export const driveChannels = pgTable(
  "drive_channels",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    channelId: varchar("channel_id", { length: 255 }).notNull(),
    resourceId: varchar("resource_id", { length: 255 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    pageToken: text("page_token"),
    expirationAt: timestamp("expiration_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    channelResourceUnique: unique("drive_channels_channel_resource_unique").on(
      table.channelId,
      table.resourceId
    )
  })
);

export const workerJobs = pgTable("worker_jobs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  jobId: varchar("job_id", { length: 128 }).notNull().unique(),
  eventId: varchar("event_id", { length: 255 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  errorSummary: text("error_summary"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const workerJobSteps = pgTable("worker_job_steps", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  jobId: varchar("job_id", { length: 128 }).notNull(),
  stepName: varchar("step_name", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  durationMs: integer("duration_ms"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const workerIdempotency = pgTable("worker_idempotency", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull().unique(),
  jobId: varchar("job_id", { length: 128 }),
  terminalState: varchar("terminal_state", { length: 32 }).notNull().default("pending"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const documentResults = pgTable("document_results", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  jobId: varchar("job_id", { length: 128 }).notNull(),
  eventId: varchar("event_id", { length: 255 }).notNull(),
  sourceFileId: varchar("source_file_id", { length: 255 }).notNull(),
  revision: varchar("revision", { length: 128 }).notNull(),
  outcome: varchar("outcome", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  finalKey: text("final_key"),
  reasonCodes: jsonb("reason_codes"),
  payload: jsonb("payload").notNull(),
  validation: jsonb("validation").notNull(),
  artifactKey: text("artifact_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => ({
  sourceFileRevisionIdx: index("document_results_source_file_revision_idx").on(table.sourceFileId, table.revision),
  outcomeIdx: index("document_results_outcome_idx").on(table.outcome)
}));
