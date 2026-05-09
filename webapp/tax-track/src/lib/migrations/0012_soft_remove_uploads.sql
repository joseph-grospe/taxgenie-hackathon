ALTER TABLE "intake_files"
ADD COLUMN "removed_from_session_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intake_files"
ADD COLUMN "removed_from_session_by_user_id" text;--> statement-breakpoint
ALTER TABLE "intake_files"
ADD CONSTRAINT "intake_files_removed_from_session_by_user_id_user_id_fk"
FOREIGN KEY ("removed_from_session_by_user_id")
REFERENCES "public"."user"("id")
ON DELETE restrict
ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intake_files_batch_removed_idx"
ON "intake_files" USING btree ("batch_id","removed_from_session_at");
