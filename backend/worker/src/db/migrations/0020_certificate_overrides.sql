ALTER TABLE "document_results"
  ADD COLUMN IF NOT EXISTS "override_status" varchar(16),
  ADD COLUMN IF NOT EXISTS "override_request_id" uuid,
  ADD COLUMN IF NOT EXISTS "overridden_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "overridden_by_user_id" text,
  ADD COLUMN IF NOT EXISTS "override_patch" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certificate_override_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_result_id" integer NOT NULL,
  "upload_id" uuid NOT NULL,
  "batch_id" uuid NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "request_note" text NOT NULL,
  "corrected_payor_tin" text,
  "corrected_payor_name" text,
  "resolved_masterlist_match" jsonb,
  "original_validation" jsonb NOT NULL,
  "original_reason_codes" jsonb,
  "decision_note" text,
  "decided_by_user_id" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "certificate_override_requests_status_check"
    CHECK ("status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "certificate_override_requests"
  ADD CONSTRAINT "certificate_override_requests_document_result_id_document_results_id_fk"
  FOREIGN KEY ("document_result_id") REFERENCES "public"."document_results"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_override_requests"
  ADD CONSTRAINT "certificate_override_requests_upload_id_intake_files_id_fk"
  FOREIGN KEY ("upload_id") REFERENCES "public"."intake_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_override_requests"
  ADD CONSTRAINT "certificate_override_requests_batch_id_intake_batches_id_fk"
  FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_override_requests"
  ADD CONSTRAINT "certificate_override_requests_requested_by_user_id_user_id_fk"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_override_requests"
  ADD CONSTRAINT "certificate_override_requests_decided_by_user_id_user_id_fk"
  FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_results"
  ADD CONSTRAINT "document_results_override_request_id_certificate_override_requests_id_fk"
  FOREIGN KEY ("override_request_id") REFERENCES "public"."certificate_override_requests"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_results"
  ADD CONSTRAINT "document_results_overridden_by_user_id_user_id_fk"
  FOREIGN KEY ("overridden_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_override_requests_document_result_idx"
  ON "certificate_override_requests" USING btree ("document_result_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_override_requests_status_created_idx"
  ON "certificate_override_requests" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_override_requests_requested_by_idx"
  ON "certificate_override_requests" USING btree ("requested_by_user_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "certificate_override_requests_pending_document_idx"
  ON "certificate_override_requests" USING btree ("document_result_id")
  WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_results_override_status_idx"
  ON "document_results" USING btree ("override_status", "status");
