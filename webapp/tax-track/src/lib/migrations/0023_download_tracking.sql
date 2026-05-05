ALTER TABLE "certificate_signed_artifacts"
ADD COLUMN IF NOT EXISTS "first_downloaded_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "last_downloaded_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "download_count" integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "first_downloaded_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_outputs"
ADD COLUMN IF NOT EXISTS "first_downloaded_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "last_downloaded_at" timestamp with time zone,
ADD COLUMN IF NOT EXISTS "download_count" integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "first_downloaded_by_user_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certificate_signed_artifacts" ADD CONSTRAINT "certificate_signed_artifacts_first_downloaded_by_user_id_user_id_fk" FOREIGN KEY ("first_downloaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certificate_merge_job_outputs" ADD CONSTRAINT "certificate_merge_job_outputs_first_downloaded_by_user_id_user_id_fk" FOREIGN KEY ("first_downloaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
