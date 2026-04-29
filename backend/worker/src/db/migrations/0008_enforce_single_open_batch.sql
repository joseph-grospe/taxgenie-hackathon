CREATE UNIQUE INDEX IF NOT EXISTS "intake_batches_one_open_per_user_idx"
ON "intake_batches" USING btree ("created_by_user_id")
WHERE "status" = 'open';
