ALTER TABLE "intake_files" ADD COLUMN "certificate_document_type" varchar(32);--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "certificate_issuer_short_name" text;--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "certificate_issuer_short_name_normalized" text;--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "certificate_recipient_short_name" text;--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "certificate_settlement_reference_number" text;--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "certificate_billing_month_mmyy" varchar(4);--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "certificate_date_uploaded" varchar(8);--> statement-breakpoint
CREATE INDEX "intake_files_certificate_issuer_billing_month_idx" ON "intake_files" USING btree ("certificate_issuer_short_name_normalized","certificate_billing_month_mmyy","uploaded_at");
