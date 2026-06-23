ALTER TABLE "intake_files"
DROP CONSTRAINT IF EXISTS "intake_files_attention_resolved_by_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "intake_files"
DROP COLUMN IF EXISTS "attention_resolved_by_user_id";--> statement-breakpoint
ALTER TABLE "intake_files"
DROP COLUMN IF EXISTS "attention_resolved_at";--> statement-breakpoint
ALTER TABLE "intake_files"
DROP COLUMN IF EXISTS "attention_status";
