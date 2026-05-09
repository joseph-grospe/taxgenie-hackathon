ALTER TABLE "document_results"
ADD COLUMN "document_kind" varchar(32) NOT NULL DEFAULT 'upload';--> statement-breakpoint
ALTER TABLE "document_results"
ADD COLUMN "page_number" integer;--> statement-breakpoint
UPDATE "document_results"
SET
  "document_kind" = CASE
    WHEN "status" = 'success' THEN 'certificate'
    ELSE 'upload'
  END,
  "page_number" = CASE
    WHEN "status" = 'success' THEN 1
    ELSE NULL
  END;--> statement-breakpoint
CREATE UNIQUE INDEX "document_results_upload_kind_page_guard_idx"
ON "document_results" USING btree ("upload_id", "document_kind", COALESCE("page_number", -1));--> statement-breakpoint
