ALTER TABLE "worker_idempotency" ADD COLUMN "claim_owner" varchar(128);
--> statement-breakpoint
ALTER TABLE "worker_idempotency" ADD COLUMN "lease_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "worker_idempotency" ADD COLUMN "last_heartbeat_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "worker_idempotency" ADD COLUMN "attempt_number" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "worker_idempotency"
SET "attempt_number" = 1
WHERE "job_id" IS NOT NULL
  AND "attempt_number" = 0;
