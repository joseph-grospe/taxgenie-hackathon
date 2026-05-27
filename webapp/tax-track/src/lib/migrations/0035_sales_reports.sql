CREATE TABLE IF NOT EXISTS "sales_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" integer NOT NULL,
  "entity_short_name" text,
  "entity_company_name" text,
  "entity_tin" text NOT NULL,
  "name" text NOT NULL,
  "status" varchar(32) DEFAULT 'uploading' NOT NULL,
  "current_version_id" uuid,
  "created_by_user_id" text NOT NULL,
  "deleted_at" timestamp with time zone,
  "deleted_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_report_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sales_report_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "uploaded_by_user_id" text NOT NULL,
  "original_file_name" text NOT NULL,
  "sanitized_file_name" text NOT NULL,
  "mime_type" varchar(255) NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_bucket" text NOT NULL,
  "storage_key" text NOT NULL,
  "artifact_uri" text,
  "parse_status" varchar(32) DEFAULT 'pending' NOT NULL,
  "row_count" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "uploaded_at" timestamp with time zone,
  "parsed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_report_rows" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "sales_report_version_id" uuid NOT NULL,
  "row_number" integer NOT NULL,
  "customer_name" text NOT NULL,
  "tin" text NOT NULL,
  "invoice_number" text NOT NULL,
  "accounting_date" text,
  "transaction_line_description" text NOT NULL,
  "taxable_sales" double precision NOT NULL,
  "output_vat" double precision NOT NULL,
  "prepaid_cwt" double precision NOT NULL,
  "issuer_shortname_used_for_match" text NOT NULL,
  "derived_billing_month_mmyy" varchar(4) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_report_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sales_report_id" uuid NOT NULL,
  "sales_report_version_id" uuid NOT NULL,
  "created_by_user_id" text NOT NULL,
  "status" varchar(32) DEFAULT 'running' NOT NULL,
  "selected_batch_count" integer DEFAULT 0 NOT NULL,
  "total_rows" integer DEFAULT 0 NOT NULL,
  "matched_count" integer DEFAULT 0 NOT NULL,
  "unmatched_count" integer DEFAULT 0 NOT NULL,
  "variance_total" double precision DEFAULT 0 NOT NULL,
  "error_message" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "archived_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_report_run_batches" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "sales_report_run_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_reports" ADD CONSTRAINT "sales_reports_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_reports" ADD CONSTRAINT "sales_reports_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_reports" ADD CONSTRAINT "sales_reports_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_report_versions" ADD CONSTRAINT "sales_report_versions_sales_report_id_sales_reports_id_fk" FOREIGN KEY ("sales_report_id") REFERENCES "public"."sales_reports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_report_versions" ADD CONSTRAINT "sales_report_versions_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_report_rows" ADD CONSTRAINT "sales_report_rows_sales_report_version_id_sales_report_versions_id_fk" FOREIGN KEY ("sales_report_version_id") REFERENCES "public"."sales_report_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_report_runs" ADD CONSTRAINT "sales_report_runs_sales_report_id_sales_reports_id_fk" FOREIGN KEY ("sales_report_id") REFERENCES "public"."sales_reports"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_report_runs" ADD CONSTRAINT "sales_report_runs_sales_report_version_id_sales_report_versions_id_fk" FOREIGN KEY ("sales_report_version_id") REFERENCES "public"."sales_report_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_report_runs" ADD CONSTRAINT "sales_report_runs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_report_runs" ADD CONSTRAINT "sales_report_runs_archived_by_user_id_user_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_report_run_batches" ADD CONSTRAINT "sales_report_run_batches_sales_report_run_id_sales_report_runs_id_fk" FOREIGN KEY ("sales_report_run_id") REFERENCES "public"."sales_report_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sales_report_run_batches" ADD CONSTRAINT "sales_report_run_batches_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_reports_entity_status_updated_idx" ON "sales_reports" USING btree ("entity_id","status","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_reports_created_by_updated_idx" ON "sales_reports" USING btree ("created_by_user_id","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_reports_deleted_at_idx" ON "sales_reports" USING btree ("deleted_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_report_versions_report_version_idx" ON "sales_report_versions" USING btree ("sales_report_id","version_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_report_versions_report_created_idx" ON "sales_report_versions" USING btree ("sales_report_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_report_versions_parse_status_idx" ON "sales_report_versions" USING btree ("parse_status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_report_rows_version_row_idx" ON "sales_report_rows" USING btree ("sales_report_version_id","row_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_report_rows_version_idx" ON "sales_report_rows" USING btree ("sales_report_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_report_rows_tin_idx" ON "sales_report_rows" USING btree ("tin");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_report_rows_invoice_idx" ON "sales_report_rows" USING btree ("invoice_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_report_rows_customer_idx" ON "sales_report_rows" USING btree ("customer_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_report_runs_report_status_created_idx" ON "sales_report_runs" USING btree ("sales_report_id","status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_report_runs_active_report_idx" ON "sales_report_runs" USING btree ("sales_report_id","created_at") WHERE "archived_at" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sales_report_run_batches_run_batch_idx" ON "sales_report_run_batches" USING btree ("sales_report_run_id","batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_report_run_batches_batch_idx" ON "sales_report_run_batches" USING btree ("batch_id");
--> statement-breakpoint
ALTER TABLE "reconciliation_results" ALTER COLUMN "upload_batch_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN IF NOT EXISTS "sales_report_id" uuid;
--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN IF NOT EXISTS "sales_report_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN IF NOT EXISTS "sales_report_run_id" uuid;
--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN IF NOT EXISTS "sales_report_row_id" integer;
--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN IF NOT EXISTS "matched_upload_batch_id" uuid;
--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN IF NOT EXISTS "archived_by_user_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_sales_report_id_sales_reports_id_fk" FOREIGN KEY ("sales_report_id") REFERENCES "public"."sales_reports"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_sales_report_version_id_sales_report_versions_id_fk" FOREIGN KEY ("sales_report_version_id") REFERENCES "public"."sales_report_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_sales_report_run_id_sales_report_runs_id_fk" FOREIGN KEY ("sales_report_run_id") REFERENCES "public"."sales_report_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_sales_report_row_id_sales_report_rows_id_fk" FOREIGN KEY ("sales_report_row_id") REFERENCES "public"."sales_report_rows"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_matched_upload_batch_id_intake_batches_id_fk" FOREIGN KEY ("matched_upload_batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_archived_by_user_id_user_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_results_sales_report_active_idx" ON "reconciliation_results" USING btree ("sales_report_id","sales_report_run_id","created_at") WHERE "archived_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_results_sales_report_run_idx" ON "reconciliation_results" USING btree ("sales_report_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_results_sales_report_row_idx" ON "reconciliation_results" USING btree ("sales_report_row_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_results_matched_upload_batch_idx" ON "reconciliation_results" USING btree ("matched_upload_batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_results_archived_at_idx" ON "reconciliation_results" USING btree ("archived_at");
