CREATE INDEX IF NOT EXISTS "intake_files_dashboard_upload_date_idx"
ON "intake_files" USING btree ((coalesce("uploaded_at", "created_at")))
WHERE "removed_from_batch_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_files_dashboard_upload_type_date_idx"
ON "intake_files" USING btree ("certificate_document_type", (coalesce("uploaded_at", "created_at")))
WHERE "removed_from_batch_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_results_dashboard_status_upload_idx"
ON "document_results" USING btree ("status", "upload_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reconciliation_results_dashboard_unmatched_created_idx"
ON "reconciliation_results" USING btree ("created_at")
WHERE "matched_tax_record_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_signed_artifacts_first_downloaded_idx"
ON "certificate_signed_artifacts" USING btree ("first_downloaded_at", "document_result_id")
WHERE "first_downloaded_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_merge_job_outputs_first_downloaded_idx"
ON "certificate_merge_job_outputs" USING btree ("first_downloaded_at", "merge_job_id", "part_number")
WHERE "first_downloaded_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificate_merge_job_inputs_output_part_idx"
ON "certificate_merge_job_inputs" USING btree ("merge_job_id", "output_part_number", "document_result_id")
WHERE "output_part_number" IS NOT NULL;
