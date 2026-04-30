ALTER TABLE "document_results" ADD COLUMN "period_end" date;--> statement-breakpoint
ALTER TABLE "document_results" ADD COLUMN "payee_name" text;--> statement-breakpoint
ALTER TABLE "document_results" ADD COLUMN "payee_tin" text;--> statement-breakpoint
ALTER TABLE "document_results" ADD COLUMN "payee_short_name" text;--> statement-breakpoint
ALTER TABLE "document_results" ADD COLUMN "payor_name" text;--> statement-breakpoint
ALTER TABLE "document_results" ADD COLUMN "payor_tin" text;--> statement-breakpoint
CREATE INDEX "document_results_payee_tin_idx" ON "document_results" USING btree ("payee_tin");--> statement-breakpoint
CREATE INDEX "document_results_payor_tin_idx" ON "document_results" USING btree ("payor_tin");--> statement-breakpoint
CREATE INDEX "document_results_payee_short_name_idx" ON "document_results" USING btree ("payee_short_name");
