ALTER TABLE "document_results"
ADD COLUMN "original_file_name" text;--> statement-breakpoint
ALTER TABLE "document_results"
ADD COLUMN "source_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "document_results"
ADD COLUMN "data_fingerprint" varchar(64);--> statement-breakpoint
CREATE INDEX "intake_files_original_file_name_idx"
ON "intake_files" USING btree ("original_file_name");--> statement-breakpoint
CREATE INDEX "document_results_original_file_name_idx"
ON "document_results" USING btree ("original_file_name");--> statement-breakpoint
CREATE INDEX "document_results_source_hash_idx"
ON "document_results" USING btree ("source_hash");--> statement-breakpoint
CREATE INDEX "document_results_data_fingerprint_idx"
ON "document_results" USING btree ("data_fingerprint");--> statement-breakpoint
