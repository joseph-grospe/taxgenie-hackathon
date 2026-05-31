ALTER TABLE "intake_batches" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
ALTER TABLE "intake_batches" ADD COLUMN IF NOT EXISTS "deleted_by_user_id" text;
ALTER TABLE "intake_batches" ADD COLUMN IF NOT EXISTS "purge_after_at" timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'intake_batches'
      AND constraint_name = 'intake_batches_deleted_by_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "intake_batches"
      ADD CONSTRAINT "intake_batches_deleted_by_user_id_user_id_fk"
      FOREIGN KEY ("deleted_by_user_id")
      REFERENCES "user"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "intake_batches_active_last_activity_idx"
ON "intake_batches" USING btree ("last_activity_at", "created_at")
WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "intake_batches_deleted_at_idx"
ON "intake_batches" USING btree ("deleted_at");

CREATE INDEX IF NOT EXISTS "intake_batches_purge_after_idx"
ON "intake_batches" USING btree ("purge_after_at")
WHERE "deleted_at" IS NOT NULL;
