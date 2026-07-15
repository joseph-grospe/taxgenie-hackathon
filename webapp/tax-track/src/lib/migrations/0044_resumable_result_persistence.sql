CREATE TABLE "certificate_processed_number_counters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"payor_short_name" text NOT NULL,
	"upload_month" date NOT NULL,
	"last_value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_processed_number_counters_positive_value_check" CHECK ("last_value" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_processed_number_counters_payor_month_idx" ON "certificate_processed_number_counters" USING btree ("payor_short_name", "upload_month");
--> statement-breakpoint
INSERT INTO "certificate_processed_number_counters" (
	"payor_short_name",
	"upload_month",
	"last_value"
)
SELECT
	"document_results"."payor_short_name",
	date_trunc('month', "intake_files"."uploaded_at")::date,
	count(*)::int
FROM "document_results"
INNER JOIN "intake_files" ON "document_results"."upload_id" = "intake_files"."id"
WHERE "document_results"."outcome" = 'Done'
	AND "document_results"."status" = 'success'
	AND "document_results"."payor_short_name" IS NOT NULL
	AND "intake_files"."uploaded_at" IS NOT NULL
GROUP BY "document_results"."payor_short_name", date_trunc('month', "intake_files"."uploaded_at")::date;
--> statement-breakpoint
CREATE TABLE "result_persistence_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"upload_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"reserved_document_result_id" integer NOT NULL,
	"outcome" varchar(32) NOT NULL,
	"state" varchar(32) DEFAULT 'pending_artifacts' NOT NULL,
	"event" jsonb NOT NULL,
	"document_result" jsonb NOT NULL,
	"certificate_metadata" jsonb NOT NULL,
	"reconciliation_input" jsonb,
	"processed_number" integer,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_persistence_operations_state_check" CHECK ("state" in ('pending_artifacts', 'ready_to_finalize', 'retryable_error', 'completed', 'blocked')),
	CONSTRAINT "result_persistence_operations_outcome_check" CHECK ("outcome" in ('Done', 'Error', 'Duplicate'))
);
--> statement-breakpoint
ALTER TABLE "result_persistence_operations" ADD CONSTRAINT "result_persistence_operations_upload_id_intake_files_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."intake_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "result_persistence_operations" ADD CONSTRAINT "result_persistence_operations_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "result_persistence_operations_event_idx" ON "result_persistence_operations" USING btree ("event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "result_persistence_operations_upload_idx" ON "result_persistence_operations" USING btree ("upload_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "result_persistence_operations_reserved_result_idx" ON "result_persistence_operations" USING btree ("reserved_document_result_id");
--> statement-breakpoint
CREATE INDEX "result_persistence_operations_retry_idx" ON "result_persistence_operations" USING btree ("state", "next_attempt_at");
--> statement-breakpoint
CREATE TABLE "result_persistence_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"role" varchar(32) NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"body_kind" varchar(32) NOT NULL,
	"body_text" text,
	"source_descriptor" jsonb,
	"sha256" varchar(64) NOT NULL,
	"state" varchar(32) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_persistence_artifacts_state_check" CHECK ("state" in ('pending', 'verified', 'blocked')),
	CONSTRAINT "result_persistence_artifacts_role_check" CHECK ("role" in ('raw_json', 'final_json', 'unsigned_pdf')),
	CONSTRAINT "result_persistence_artifacts_body_kind_check" CHECK ("body_kind" in ('text', 'source_page'))
);
--> statement-breakpoint
ALTER TABLE "result_persistence_artifacts" ADD CONSTRAINT "result_persistence_artifacts_operation_id_result_persistence_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."result_persistence_operations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "result_persistence_artifacts_operation_role_idx" ON "result_persistence_artifacts" USING btree ("operation_id", "role");
--> statement-breakpoint
CREATE UNIQUE INDEX "result_persistence_artifacts_bucket_key_idx" ON "result_persistence_artifacts" USING btree ("bucket", "key");
--> statement-breakpoint
CREATE INDEX "result_persistence_artifacts_operation_idx" ON "result_persistence_artifacts" USING btree ("operation_id");
