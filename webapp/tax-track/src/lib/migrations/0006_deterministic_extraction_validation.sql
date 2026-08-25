ALTER TABLE "document_extraction_attempts" ADD COLUMN IF NOT EXISTS "schema_issues" jsonb;
