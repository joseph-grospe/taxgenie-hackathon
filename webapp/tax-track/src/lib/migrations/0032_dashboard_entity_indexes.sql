CREATE INDEX IF NOT EXISTS "intake_batches_entity_id_idx"
ON "intake_batches" USING btree ("entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_batches_entity_short_name_idx"
ON "intake_batches" USING btree ("entity_short_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_batches_entity_company_name_idx"
ON "intake_batches" USING btree ("entity_company_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_results_requesting_entity_short_name_idx"
ON "reconciliation_results" USING btree ("requesting_entity_short_name");
