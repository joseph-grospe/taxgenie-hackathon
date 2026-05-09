ALTER TABLE "document_results" ADD COLUMN IF NOT EXISTS "payor_short_name" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_results_payor_short_name_idx" ON "document_results" USING btree ("payor_short_name");
