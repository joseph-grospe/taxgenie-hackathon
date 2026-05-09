ALTER TABLE IF EXISTS "intake_batches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE IF EXISTS "intake_batches" CASCADE;--> statement-breakpoint
ALTER TABLE "document_results" DROP CONSTRAINT IF EXISTS "document_results_batch_id_intake_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "intake_files" DROP CONSTRAINT IF EXISTS "intake_files_batch_id_intake_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "worker_jobs" DROP CONSTRAINT IF EXISTS "worker_jobs_batch_id_intake_batches_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "document_results_batch_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "intake_files_batch_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "worker_jobs_batch_idx";--> statement-breakpoint
ALTER TABLE "document_results" DROP COLUMN IF EXISTS "batch_id";--> statement-breakpoint
ALTER TABLE "intake_files" DROP COLUMN IF EXISTS "batch_id";--> statement-breakpoint
ALTER TABLE "worker_jobs" DROP COLUMN IF EXISTS "batch_id";
