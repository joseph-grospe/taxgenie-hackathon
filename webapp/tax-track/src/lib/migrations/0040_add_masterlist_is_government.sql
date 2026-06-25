ALTER TABLE "masterlist"
ADD COLUMN IF NOT EXISTS "is_government" boolean NOT NULL DEFAULT false;
