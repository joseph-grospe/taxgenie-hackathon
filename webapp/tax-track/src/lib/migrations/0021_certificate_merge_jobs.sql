CREATE TABLE "certificate_merge_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" text NOT NULL,
	"payee_short_name" text NOT NULL,
	"entity_tin" text NOT NULL,
	"period_type" varchar(16) NOT NULL,
	"year" integer NOT NULL,
	"quarter" integer,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"aws_batch_job_id" text,
	"aws_batch_status" varchar(32),
	"total_input_files" integer DEFAULT 0 NOT NULL,
	"total_size_bytes" bigint DEFAULT 0 NOT NULL,
	"output_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"submitted_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_merge_job_inputs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "certificate_merge_job_inputs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"merge_job_id" uuid NOT NULL,
	"document_result_id" integer NOT NULL,
	"signed_artifact_id" uuid NOT NULL,
	"signed_pdf_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"input_order" integer NOT NULL,
	"output_part_number" integer,
	"original_file_name" text,
	"payee_tin" text,
	"period_end" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_merge_job_outputs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "certificate_merge_job_outputs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"merge_job_id" uuid NOT NULL,
	"part_number" integer NOT NULL,
	"file_name" text NOT NULL,
	"output_key" text NOT NULL,
	"size_bytes" bigint,
	"input_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"etag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificate_merge_jobs" ADD CONSTRAINT "certificate_merge_jobs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD CONSTRAINT "certificate_merge_job_inputs_merge_job_id_certificate_merge_jobs_id_fk" FOREIGN KEY ("merge_job_id") REFERENCES "public"."certificate_merge_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD CONSTRAINT "certificate_merge_job_inputs_document_result_id_document_results_id_fk" FOREIGN KEY ("document_result_id") REFERENCES "public"."document_results"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD CONSTRAINT "certificate_merge_job_inputs_signed_artifact_id_certificate_signed_artifacts_id_fk" FOREIGN KEY ("signed_artifact_id") REFERENCES "public"."certificate_signed_artifacts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_outputs" ADD CONSTRAINT "certificate_merge_job_outputs_merge_job_id_certificate_merge_jobs_id_fk" FOREIGN KEY ("merge_job_id") REFERENCES "public"."certificate_merge_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "certificate_merge_jobs_created_by_idx" ON "certificate_merge_jobs" USING btree ("created_by_user_id","created_at");
--> statement-breakpoint
CREATE INDEX "certificate_merge_jobs_selection_idx" ON "certificate_merge_jobs" USING btree ("payee_short_name","period_type","year","quarter");
--> statement-breakpoint
CREATE INDEX "certificate_merge_jobs_batch_job_idx" ON "certificate_merge_jobs" USING btree ("aws_batch_job_id");
--> statement-breakpoint
CREATE INDEX "certificate_merge_jobs_status_idx" ON "certificate_merge_jobs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "certificate_merge_job_inputs_job_idx" ON "certificate_merge_job_inputs" USING btree ("merge_job_id","input_order");
--> statement-breakpoint
CREATE INDEX "certificate_merge_job_inputs_document_result_idx" ON "certificate_merge_job_inputs" USING btree ("document_result_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_merge_job_inputs_job_document_idx" ON "certificate_merge_job_inputs" USING btree ("merge_job_id","document_result_id");
--> statement-breakpoint
CREATE INDEX "certificate_merge_job_outputs_job_idx" ON "certificate_merge_job_outputs" USING btree ("merge_job_id","part_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_merge_job_outputs_job_part_idx" ON "certificate_merge_job_outputs" USING btree ("merge_job_id","part_number");
