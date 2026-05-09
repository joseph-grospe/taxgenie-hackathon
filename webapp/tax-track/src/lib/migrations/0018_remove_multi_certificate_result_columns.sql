DROP INDEX IF EXISTS "document_results_upload_kind_page_guard_idx";--> statement-breakpoint
ALTER TABLE "document_results" DROP COLUMN IF EXISTS "document_kind";--> statement-breakpoint
ALTER TABLE "document_results" DROP COLUMN IF EXISTS "page_number";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_results_upload_guard_idx"
ON "document_results" USING btree ("upload_id");--> statement-breakpoint
