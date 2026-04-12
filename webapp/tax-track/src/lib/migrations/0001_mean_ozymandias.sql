CREATE TABLE "document_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_id" varchar(128) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"batch_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"source_file_id" varchar(255) NOT NULL,
	"revision" varchar(128) NOT NULL,
	"outcome" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"final_key" text,
	"reason_codes" jsonb,
	"payload" jsonb NOT NULL,
	"validation" jsonb NOT NULL,
	"artifact_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" text NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"total_files" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"original_file_name" text NOT NULL,
	"sanitized_file_name" text NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"artifact_uri" text,
	"source_file_id" varchar(255),
	"revision" varchar(255),
	"event_id" varchar(255),
	"trace_id" varchar(255),
	"queue_message_id" varchar(255),
	"upload_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"queue_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"processing_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"current_phase" varchar(32),
	"current_step" varchar(128),
	"error_message" text,
	"uploaded_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"processing_finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_idempotency" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "worker_idempotency_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"idempotency_key" varchar(255) NOT NULL,
	"job_id" varchar(128),
	"terminal_state" varchar(32) DEFAULT 'pending' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_idempotency_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "worker_job_steps" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "worker_job_steps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_id" varchar(128) NOT NULL,
	"step_name" varchar(128) NOT NULL,
	"status" varchar(32) NOT NULL,
	"duration_ms" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "worker_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_id" varchar(128) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"batch_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"original_file_name" text NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"current_phase" varchar(32),
	"current_step" varchar(128),
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
ALTER TABLE "document_results" ADD CONSTRAINT "document_results_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_results" ADD CONSTRAINT "document_results_upload_id_intake_files_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."intake_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_batches" ADD CONSTRAINT "intake_batches_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_files" ADD CONSTRAINT "intake_files_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_files" ADD CONSTRAINT "intake_files_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD CONSTRAINT "worker_jobs_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD CONSTRAINT "worker_jobs_upload_id_intake_files_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."intake_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_results_batch_idx" ON "document_results" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "document_results_upload_idx" ON "document_results" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "document_results_source_file_revision_idx" ON "document_results" USING btree ("source_file_id","revision");--> statement-breakpoint
CREATE INDEX "document_results_outcome_idx" ON "document_results" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "intake_files_batch_idx" ON "intake_files" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "intake_files_event_id_idx" ON "intake_files" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "intake_files_source_file_revision_idx" ON "intake_files" USING btree ("source_file_id","revision");--> statement-breakpoint
CREATE INDEX "worker_job_steps_job_idx" ON "worker_job_steps" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "worker_jobs_batch_idx" ON "worker_jobs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "worker_jobs_upload_idx" ON "worker_jobs" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "worker_jobs_event_idx" ON "worker_jobs" USING btree ("event_id");