CREATE TABLE IF NOT EXISTS "reconciliation_result_collections" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "reconciliation_result_id" integer NOT NULL,
  "document_result_id" integer NOT NULL,
  "batch_id" uuid,
  "upload_id" uuid,
  "source_file_id" varchar(255),
  "tax_base" double precision,
  "tax_withheld" double precision,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_result_collections" ADD CONSTRAINT "reconciliation_result_collections_result_id_fk" FOREIGN KEY ("reconciliation_result_id") REFERENCES "public"."reconciliation_results"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_result_collections" ADD CONSTRAINT "reconciliation_result_collections_document_result_id_fk" FOREIGN KEY ("document_result_id") REFERENCES "public"."document_results"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_result_collections" ADD CONSTRAINT "reconciliation_result_collections_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_result_collections" ADD CONSTRAINT "reconciliation_result_collections_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."intake_files"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "reconciliation_result_collections" (
  "reconciliation_result_id",
  "document_result_id",
  "batch_id",
  "upload_id",
  "source_file_id",
  "tax_base",
  "tax_withheld",
  "applied_at",
  "archived_at",
  "created_at",
  "updated_at"
)
SELECT
  ranked."reconciliation_result_id",
  ranked."document_result_id",
  ranked."batch_id",
  ranked."upload_id",
  ranked."source_file_id",
  ranked."tax_base",
  ranked."tax_withheld",
  ranked."applied_at",
  CASE
    WHEN ranked."result_archived_at" IS NOT NULL THEN ranked."result_archived_at"
    WHEN ranked."active_rank" = 1 THEN NULL
    ELSE now()
  END AS "archived_at",
  ranked."created_at",
  ranked."updated_at"
FROM (
  SELECT
    rr."id" AS "reconciliation_result_id",
    rr."matched_tax_record_id" AS "document_result_id",
    rr."matched_upload_batch_id" AS "batch_id",
    dr."upload_id",
    dr."source_file_id",
    rr."tax_base",
    rr."tax_withheld",
    coalesce(rr."matched_at", rr."updated_at", rr."created_at", now()) AS "applied_at",
    rr."archived_at" AS "result_archived_at",
    coalesce(rr."created_at", now()) AS "created_at",
    coalesce(rr."updated_at", now()) AS "updated_at",
    row_number() OVER (
      PARTITION BY rr."matched_tax_record_id", (rr."archived_at" IS NULL)
      ORDER BY coalesce(rr."matched_at", rr."updated_at", rr."created_at", now()) DESC, rr."id" ASC
    ) AS "active_rank"
  FROM "reconciliation_results" rr
  INNER JOIN "document_results" dr ON dr."id" = rr."matched_tax_record_id"
  WHERE rr."matched_tax_record_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "reconciliation_result_collections" existing
      WHERE existing."reconciliation_result_id" = rr."id"
        AND existing."document_result_id" = rr."matched_tax_record_id"
    )
) ranked;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_result_collections_result_idx" ON "reconciliation_result_collections" USING btree ("reconciliation_result_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_result_collections_document_result_idx" ON "reconciliation_result_collections" USING btree ("document_result_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reconciliation_result_collections_active_document_result_idx" ON "reconciliation_result_collections" USING btree ("document_result_id") WHERE "archived_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_result_collections_batch_idx" ON "reconciliation_result_collections" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_result_collections_active_result_idx" ON "reconciliation_result_collections" USING btree ("reconciliation_result_id","applied_at") WHERE "archived_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_result_collections_archived_at_idx" ON "reconciliation_result_collections" USING btree ("archived_at");
