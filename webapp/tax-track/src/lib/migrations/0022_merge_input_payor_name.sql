ALTER TABLE "certificate_merge_job_inputs"
ADD COLUMN IF NOT EXISTS "payor_name" text;
