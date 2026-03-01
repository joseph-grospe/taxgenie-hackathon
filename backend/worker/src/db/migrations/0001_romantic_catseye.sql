ALTER TABLE "document_results"
  ADD COLUMN IF NOT EXISTS "outcome" varchar(32),
  ADD COLUMN IF NOT EXISTS "status" varchar(32),
  ADD COLUMN IF NOT EXISTS "final_key" text,
  ADD COLUMN IF NOT EXISTS "reason_codes" jsonb;

UPDATE "document_results"
SET "outcome" = COALESCE("outcome", 'Done')
WHERE "outcome" IS NULL;

UPDATE "document_results"
SET "status" = COALESCE("status", 'success')
WHERE "status" IS NULL;

ALTER TABLE "document_results" ALTER COLUMN "outcome" SET NOT NULL;
ALTER TABLE "document_results" ALTER COLUMN "status" SET NOT NULL;

CREATE INDEX "document_results_source_file_revision_idx" ON "document_results" USING btree ("source_file_id","revision");--> statement-breakpoint
CREATE INDEX "document_results_outcome_idx" ON "document_results" USING btree ("outcome");--> statement-breakpoint
