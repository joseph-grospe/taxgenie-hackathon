ALTER TABLE "document_extraction_attempts"
	ADD COLUMN IF NOT EXISTS "schema_issues" jsonb;
--> statement-breakpoint
ALTER TABLE "document_extraction_attempts"
	ALTER COLUMN "schema_issues" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "document_extraction_attempts"
	ALTER COLUMN "schema_issues" DROP DEFAULT;
