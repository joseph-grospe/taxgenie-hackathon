ALTER TABLE "intake_batches" ADD COLUMN IF NOT EXISTS "entity_short_name" text;--> statement-breakpoint
ALTER TABLE "intake_batches" ADD COLUMN IF NOT EXISTS "entity_company_name" text;--> statement-breakpoint
ALTER TABLE "intake_batches" ADD COLUMN IF NOT EXISTS "entity_tin" text;
