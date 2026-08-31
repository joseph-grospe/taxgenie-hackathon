ALTER TABLE "intake_files" RENAME COLUMN "queue_message_id" TO "dispatch_id";--> statement-breakpoint
ALTER TABLE "intake_files" ALTER COLUMN "dispatch_id" TYPE varchar(512);--> statement-breakpoint
ALTER TABLE "certificate_merge_jobs" RENAME COLUMN "aws_batch_job_id" TO "provider_job_id";--> statement-breakpoint
ALTER TABLE "certificate_merge_jobs" RENAME COLUMN "aws_batch_status" TO "provider_job_status";--> statement-breakpoint
ALTER INDEX IF EXISTS "certificate_merge_jobs_batch_job_idx" RENAME TO "certificate_merge_jobs_provider_job_idx";
