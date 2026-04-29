CREATE TABLE "certificate_signature_templates" (
	"template_key" text PRIMARY KEY NOT NULL,
	"page_number" integer DEFAULT 1 NOT NULL,
	"signature_rect" jsonb NOT NULL,
	"name_rect" jsonb NOT NULL,
	"designation_rect" jsonb NOT NULL,
	"tin_rect" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_signed_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_result_id" integer NOT NULL,
	"signed_by_user_id" text NOT NULL,
	"signature_profile_snapshot" jsonb NOT NULL,
	"placement_snapshot" jsonb NOT NULL,
	"source_pdf_key" text NOT NULL,
	"signed_pdf_key" text,
	"status" varchar(32) DEFAULT 'signed' NOT NULL,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_signature_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"designation" text NOT NULL,
	"tin" text NOT NULL,
	"signature_image_key" text NOT NULL,
	"signature_image_mime_type" varchar(32) NOT NULL,
	"signature_image_width" integer NOT NULL,
	"signature_image_height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificate_signature_templates" ADD CONSTRAINT "certificate_signature_templates_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_signature_templates" ADD CONSTRAINT "certificate_signature_templates_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_signed_artifacts" ADD CONSTRAINT "certificate_signed_artifacts_document_result_id_document_results_id_fk" FOREIGN KEY ("document_result_id") REFERENCES "public"."document_results"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_signed_artifacts" ADD CONSTRAINT "certificate_signed_artifacts_signed_by_user_id_user_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_signature_profiles" ADD CONSTRAINT "user_signature_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_signed_artifacts_document_result_idx" ON "certificate_signed_artifacts" USING btree ("document_result_id");
--> statement-breakpoint
CREATE INDEX "certificate_signed_artifacts_signer_idx" ON "certificate_signed_artifacts" USING btree ("signed_by_user_id");
