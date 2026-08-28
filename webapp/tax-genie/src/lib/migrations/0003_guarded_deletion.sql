ALTER TABLE "intake_batches" ADD COLUMN "purge_status" varchar(16);--> statement-breakpoint
ALTER TABLE "intake_batches" ADD COLUMN "purge_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intake_batches" ADD COLUMN "purge_requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "intake_batches" ADD COLUMN "purge_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intake_batches" ADD COLUMN "purge_error" text;--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "purge_status" varchar(16);--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "purge_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "purge_requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "purge_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "purge_error" text;--> statement-breakpoint
ALTER TABLE "intake_batches" ADD CONSTRAINT "intake_batches_purge_requested_by_user_id_user_id_fk" FOREIGN KEY ("purge_requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_files" ADD CONSTRAINT "intake_files_purge_requested_by_user_id_user_id_fk" FOREIGN KEY ("purge_requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "intake_batches"
SET "purge_status" = 'scheduled'
WHERE "deleted_at" IS NOT NULL AND "purge_status" IS NULL;--> statement-breakpoint
CREATE INDEX "intake_batches_purge_status_idx" ON "intake_batches" USING btree ("purge_status","purge_requested_at");--> statement-breakpoint
CREATE INDEX "intake_files_purge_status_idx" ON "intake_files" USING btree ("purge_status","purge_requested_at");
