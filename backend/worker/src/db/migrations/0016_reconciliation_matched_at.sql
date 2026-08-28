ALTER TABLE "reconciliation_results" ADD COLUMN IF NOT EXISTS "matched_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_results_matched_at_idx" ON "reconciliation_results" USING btree ("matched_at");
