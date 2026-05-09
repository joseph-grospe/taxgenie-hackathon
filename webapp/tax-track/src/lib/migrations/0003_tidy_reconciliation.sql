CREATE TABLE "reconciliation_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reconciliation_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"upload_batch_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"tin" text NOT NULL,
	"invoice_number" text NOT NULL,
	"accounting_date" text,
	"transaction_line_description" text NOT NULL,
	"taxable_sales" double precision NOT NULL,
	"output_vat" double precision NOT NULL,
	"prepaid_cwt" double precision NOT NULL,
	"issuer_shortname_used_for_match" text NOT NULL,
	"derived_billing_month_mmyy" varchar(4) NOT NULL,
	"matched_tax_record_id" integer,
	"tax_base" double precision,
	"tax_withheld" double precision,
	"tax_base_difference" double precision NOT NULL,
	"tax_withheld_difference" double precision NOT NULL,
	"has_difference" boolean NOT NULL,
	"match_status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_matched_tax_record_id_document_results_id_fk" FOREIGN KEY ("matched_tax_record_id") REFERENCES "public"."document_results"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reconciliation_results_upload_batch_idx" ON "reconciliation_results" USING btree ("upload_batch_id");--> statement-breakpoint
CREATE INDEX "reconciliation_results_matched_tax_record_idx" ON "reconciliation_results" USING btree ("matched_tax_record_id");--> statement-breakpoint
CREATE INDEX "reconciliation_results_created_at_idx" ON "reconciliation_results" USING btree ("created_at");