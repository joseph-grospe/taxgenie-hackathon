ALTER TABLE "intake_files"
ADD COLUMN "removed_from_session_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intake_files"
ADD COLUMN "removed_from_session_by_user_id" text;--> statement-breakpoint
CREATE INDEX "intake_files_batch_removed_idx"
ON "intake_files" USING btree ("batch_id","removed_from_session_at");
