ALTER TABLE "security_audit_logs" RENAME COLUMN "targetUserId" TO "targetId";
--> statement-breakpoint
ALTER TABLE "security_audit_logs" ADD COLUMN "targetType" varchar(16);
--> statement-breakpoint
UPDATE "security_audit_logs"
SET "targetType" = 'user'
WHERE "targetId" IS NOT NULL
  AND "targetType" IS NULL;
--> statement-breakpoint
UPDATE "security_audit_logs"
SET
  "targetId" = "metadata" ->> 'batchId',
  "targetType" = 'batch'
WHERE "targetId" IS NULL
  AND "targetType" IS NULL
  AND "eventType" IN (
    'certificate_signed',
    'certificate_resigned',
    'certificate_sign_failed'
  )
  AND "metadata" ? 'batchId'
  AND nullif(trim("metadata" ->> 'batchId'), '') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_audit_logs_occurred_at_idx"
ON "security_audit_logs" USING btree ("occurredAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_audit_logs_event_type_idx"
ON "security_audit_logs" USING btree ("eventType");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_audit_logs_actor_user_id_idx"
ON "security_audit_logs" USING btree ("actorUserId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_audit_logs_target_type_idx"
ON "security_audit_logs" USING btree ("targetType");
