CREATE TABLE "atc_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "atc_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tax_type" text NOT NULL,
	"code" varchar(32) NOT NULL,
	"description" text NOT NULL,
	"rate" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "atc_codes_code_normalized_check" CHECK ("atc_codes"."code" = regexp_replace(upper(trim("atc_codes"."code")), '[^A-Z0-9]', '', 'g') and length("atc_codes"."code") > 0),
	CONSTRAINT "atc_codes_rate_positive_check" CHECK ("atc_codes"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"impersonatedBy" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"team" text DEFAULT 'it' NOT NULL,
	"mustChangePassword" boolean DEFAULT false NOT NULL,
	"canExportPdf" boolean DEFAULT false NOT NULL,
	"canExportExcel" boolean DEFAULT false NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false NOT NULL,
	"banReason" text,
	"banExpires" timestamp with time zone,
	"deletedAt" timestamp with time zone,
	"deletedByUserId" text,
	"deletedReason" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_stage_timings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "batch_stage_timings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"batch_id" uuid NOT NULL,
	"stage" varchar(32) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"dedupe_key" varchar(255),
	"source_type" varchar(64),
	"source_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_merge_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certificate_id" integer NOT NULL,
	"package_type" varchar(16) NOT NULL,
	"source_year" integer NOT NULL,
	"source_quarter" integer,
	"assigned_year" integer,
	"assigned_quarter" integer,
	"status" varchar(32) DEFAULT 'assigned' NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"reason" text DEFAULT 'natural_period' NOT NULL,
	"assigned_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_merge_job_batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "certificate_merge_job_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"merge_job_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_merge_job_inputs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "certificate_merge_job_inputs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"merge_job_id" uuid NOT NULL,
	"certificate_id" integer NOT NULL,
	"signed_artifact_id" uuid NOT NULL,
	"signed_pdf_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"input_order" integer NOT NULL,
	"output_part_number" integer,
	"merge_assignment_id" uuid,
	"source_package_type" varchar(16),
	"source_year" integer,
	"source_quarter" integer,
	"assigned_year" integer,
	"assigned_quarter" integer,
	"is_late" boolean DEFAULT false NOT NULL,
	"assignment_reason" text,
	"original_file_name" text,
	"payor_name" text,
	"payee_tin" text,
	"period_end" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_merge_job_outputs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "certificate_merge_job_outputs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"merge_job_id" uuid NOT NULL,
	"part_number" integer NOT NULL,
	"file_name" text NOT NULL,
	"output_key" text NOT NULL,
	"size_bytes" bigint,
	"input_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"etag" text,
	"first_downloaded_at" timestamp with time zone,
	"last_downloaded_at" timestamp with time zone,
	"download_count" integer DEFAULT 0 NOT NULL,
	"first_downloaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_merge_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" text NOT NULL,
	"payee_short_name" text NOT NULL,
	"entity_tin" text NOT NULL,
	"period_type" varchar(16) NOT NULL,
	"year" integer NOT NULL,
	"quarter" integer,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"aws_batch_job_id" text,
	"aws_batch_status" varchar(32),
	"total_input_files" integer DEFAULT 0 NOT NULL,
	"total_size_bytes" bigint DEFAULT 0 NOT NULL,
	"output_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"submitted_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_override_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"field_path" text NOT NULL,
	"original_value" jsonb,
	"proposed_value" jsonb,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"decided_by_user_id" text,
	"request_note" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_override_changes_status_check" CHECK ("certificate_override_changes"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "certificate_override_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certificate_id" integer NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"request_note" text NOT NULL,
	"decision_note" text,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_override_requests_status_check" CHECK ("certificate_override_requests"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "certificate_processed_number_counters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "certificate_processed_number_counters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"payor_short_name" text NOT NULL,
	"upload_month" date NOT NULL,
	"last_value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_processed_number_counters_positive_value_check" CHECK ("certificate_processed_number_counters"."last_value" > 0)
);
--> statement-breakpoint
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
	"certificate_id" integer NOT NULL,
	"signed_by_user_id" text NOT NULL,
	"signature_profile_snapshot" jsonb NOT NULL,
	"placement_snapshot" jsonb NOT NULL,
	"source_pdf_key" text NOT NULL,
	"signed_pdf_key" text,
	"status" varchar(32) DEFAULT 'signed' NOT NULL,
	"signed_at" timestamp with time zone,
	"first_downloaded_at" timestamp with time zone,
	"last_downloaded_at" timestamp with time zone,
	"download_count" integer DEFAULT 0 NOT NULL,
	"first_downloaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_tax_rows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "certificate_tax_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"certificate_id" integer NOT NULL,
	"line_number" integer NOT NULL,
	"page_number" integer NOT NULL,
	"atc_code" varchar(32) NOT NULL,
	"description" text,
	"first_month_amount" numeric(18, 2),
	"second_month_amount" numeric(18, 2),
	"third_month_amount" numeric(18, 2),
	"tax_base" numeric(18, 2) NOT NULL,
	"tax_rate" numeric(9, 6) NOT NULL,
	"tax_withheld" numeric(18, 2) NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificate_tax_rows_line_number_check" CHECK ("certificate_tax_rows"."line_number" > 0),
	CONSTRAINT "certificate_tax_rows_page_number_check" CHECK ("certificate_tax_rows"."page_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "document_extraction_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_extraction_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"upload_id" uuid NOT NULL,
	"job_id" varchar(128) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"revision" varchar(128) NOT NULL,
	"worker_attempt_number" integer NOT NULL,
	"trigger" varchar(32) NOT NULL,
	"retry_number" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"requested_model" varchar(128),
	"response_model" varchar(128),
	"thinking_level" varchar(32),
	"media_resolution" varchar(32),
	"provider_attempt_count" integer,
	"latency_ms" integer,
	"prompt_token_count" integer,
	"output_token_count" integer,
	"thought_token_count" integer,
	"total_token_count" integer,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_extraction_attempts_trigger_check" CHECK ("document_extraction_attempts"."trigger" in ('initial', 'manual_retry')),
	CONSTRAINT "document_extraction_attempts_status_check" CHECK ("document_extraction_attempts"."status" in ('processing', 'succeeded', 'failed')),
	CONSTRAINT "document_extraction_attempts_retry_number_check" CHECK ("document_extraction_attempts"."worker_attempt_number" > 0 and (("document_extraction_attempts"."trigger" = 'initial' and "document_extraction_attempts"."retry_number" = 0) or ("document_extraction_attempts"."trigger" = 'manual_retry' and "document_extraction_attempts"."retry_number" > 0)))
);
--> statement-breakpoint
CREATE TABLE "document_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "document_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_id" varchar(128) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"batch_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"current_extraction_attempt_id" integer NOT NULL,
	"source_file_id" varchar(255) NOT NULL,
	"revision" varchar(128) NOT NULL,
	"status" varchar(32) NOT NULL,
	"document_type" varchar(32) NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"certificate_count" integer DEFAULT 0 NOT NULL,
	"source_hash" varchar(64),
	"reason_codes" jsonb NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_results_status_check" CHECK ("document_results"."status" in ('accepted', 'error', 'duplicate')),
	CONSTRAINT "document_results_document_type_check" CHECK ("document_results"."document_type" in ('BIR_2307', 'NON_BIR_2307', 'UNKNOWN')),
	CONSTRAINT "document_results_page_count_check" CHECK ("document_results"."page_count" >= 0 and "document_results"."certificate_count" >= 0),
	CONSTRAINT "document_results_payload_check" CHECK ("document_results"."status" = 'error' or "document_results"."payload" is not null)
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"short_name" text,
	"company_name" text,
	"bir_registered_address" text,
	"zip_code" text,
	"tin" text,
	"email_address" text,
	"region_email_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extracted_certificates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "extracted_certificates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"document_result_id" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"certificate_key" varchar(128) NOT NULL,
	"page_numbers" jsonb NOT NULL,
	"status" varchar(32) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"month_of_quarter" varchar(8) NOT NULL,
	"payee_name" text NOT NULL,
	"payee_tin" text NOT NULL,
	"payee_address" text,
	"payee_zip" text,
	"payee_short_name" text,
	"payor_name" text NOT NULL,
	"payor_tin" text NOT NULL,
	"payor_address" text,
	"payor_zip" text,
	"payor_short_name" text,
	"primary_atc_code" varchar(32) NOT NULL,
	"total_tax_base" numeric(18, 2) NOT NULL,
	"total_tax_withheld" numeric(18, 2) NOT NULL,
	"signer_printed_name" text,
	"signer_title" text,
	"signer_tin" text,
	"signer_company_name" text,
	"signature_present" boolean DEFAULT false NOT NULL,
	"signature_confidence" numeric(5, 4) NOT NULL,
	"signature_page_number" integer,
	"signature_source" varchar(32) NOT NULL,
	"validation_status" varchar(16) NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"validation_summary" jsonb,
	"masterlist_resolution" jsonb,
	"confidence_summary" jsonb NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extracted_certificates_status_check" CHECK ("extracted_certificates"."status" in ('accepted', 'error', 'duplicate')),
	CONSTRAINT "extracted_certificates_validation_status_check" CHECK ("extracted_certificates"."validation_status" in ('valid', 'invalid')),
	CONSTRAINT "extracted_certificates_ordinal_check" CHECK ("extracted_certificates"."ordinal" > 0),
	CONSTRAINT "extracted_certificates_page_numbers_check" CHECK (jsonb_typeof("extracted_certificates"."page_numbers") = 'array' and jsonb_array_length("extracted_certificates"."page_numbers") > 0)
);
--> statement-breakpoint
CREATE TABLE "intake_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"entity_id" integer,
	"entity_short_name" text,
	"entity_company_name" text,
	"entity_tin" text,
	"created_by_user_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"total_files" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" text,
	"purge_after_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"original_file_name" text NOT NULL,
	"sanitized_file_name" text NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"artifact_uri" text,
	"source_file_id" varchar(255),
	"revision" varchar(255),
	"event_id" varchar(255),
	"trace_id" varchar(255),
	"queue_message_id" varchar(255),
	"certificate_document_type" varchar(32),
	"certificate_issuer_short_name" text,
	"certificate_issuer_short_name_normalized" text,
	"certificate_recipient_short_name" text,
	"certificate_settlement_reference_number" text,
	"certificate_billing_month_mmyy" varchar(4),
	"certificate_date_uploaded" varchar(8),
	"upload_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"queue_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"processing_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"removed_from_batch_at" timestamp with time zone,
	"removed_from_batch_by_user_id" text,
	"current_phase" varchar(32),
	"current_step" varchar(128),
	"error_message" text,
	"uploaded_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"processing_finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "masterlist" (
	"region" text,
	"entity" text,
	"short_name" text,
	"customer_name" text,
	"tin" text,
	"address" text,
	"email_address" text,
	"is_government" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_result_collections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reconciliation_result_collections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reconciliation_result_id" integer NOT NULL,
	"certificate_id" integer NOT NULL,
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
CREATE TABLE "reconciliation_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reconciliation_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"upload_batch_id" uuid,
	"sales_report_id" uuid,
	"sales_report_version_id" uuid,
	"sales_report_run_id" uuid,
	"sales_report_row_id" integer,
	"matched_upload_batch_id" uuid,
	"requesting_entity_short_name" text,
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
	"matched_certificate_id" integer,
	"tax_base" double precision,
	"tax_withheld" double precision,
	"tax_base_difference" double precision NOT NULL,
	"tax_withheld_difference" double precision NOT NULL,
	"has_difference" boolean NOT NULL,
	"match_status" varchar(32) NOT NULL,
	"matched_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "result_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_result_id" integer NOT NULL,
	"certificate_id" integer,
	"role" varchar(32) NOT NULL,
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_artifacts_role_check" CHECK ("result_artifacts"."role" in ('source_pdf', 'certificate_pdf')),
	CONSTRAINT "result_artifacts_scope_check" CHECK (("result_artifacts"."role" = 'source_pdf' and "result_artifacts"."certificate_id" is null) or ("result_artifacts"."role" = 'certificate_pdf' and "result_artifacts"."certificate_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "sales_report_rows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_report_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sales_report_version_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_report_run_batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_report_run_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sales_report_run_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_report_id" uuid NOT NULL,
	"sales_report_version_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"selected_batch_count" integer DEFAULT 0 NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"unmatched_count" integer DEFAULT 0 NOT NULL,
	"variance_total" double precision DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_report_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"original_file_name" text NOT NULL,
	"sanitized_file_name" text NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"artifact_uri" text,
	"parse_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"uploaded_at" timestamp with time zone,
	"parsed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" integer NOT NULL,
	"entity_short_name" text,
	"entity_company_name" text,
	"entity_tin" text NOT NULL,
	"name" text NOT NULL,
	"status" varchar(32) DEFAULT 'uploading' NOT NULL,
	"current_version_id" uuid,
	"created_by_user_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurredAt" timestamp with time zone DEFAULT now() NOT NULL,
	"eventType" varchar(64) NOT NULL,
	"actorUserId" text,
	"targetId" text,
	"targetType" varchar(16),
	"metadata" jsonb,
	"ipAddress" text,
	"userAgent" text
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
CREATE TABLE "worker_idempotency" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "worker_idempotency_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"idempotency_key" varchar(255) NOT NULL,
	"job_id" varchar(128),
	"terminal_state" varchar(32) DEFAULT 'pending' NOT NULL,
	"claim_owner" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"attempt_number" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_idempotency_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "worker_job_steps" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "worker_job_steps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_id" varchar(128) NOT NULL,
	"step_name" varchar(128) NOT NULL,
	"status" varchar(32) NOT NULL,
	"duration_ms" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "worker_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_id" varchar(128) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"batch_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"original_file_name" text NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"current_phase" varchar(32),
	"current_step" varchar(128),
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_stage_timings" ADD CONSTRAINT "batch_stage_timings_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_merge_assignments" ADD CONSTRAINT "certificate_merge_assignments_certificate_id_extracted_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."extracted_certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_merge_assignments" ADD CONSTRAINT "certificate_merge_assignments_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_merge_job_batches" ADD CONSTRAINT "certificate_merge_job_batches_merge_job_id_certificate_merge_jobs_id_fk" FOREIGN KEY ("merge_job_id") REFERENCES "public"."certificate_merge_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_merge_job_batches" ADD CONSTRAINT "certificate_merge_job_batches_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD CONSTRAINT "certificate_merge_job_inputs_merge_job_id_certificate_merge_jobs_id_fk" FOREIGN KEY ("merge_job_id") REFERENCES "public"."certificate_merge_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD CONSTRAINT "certificate_merge_job_inputs_certificate_id_extracted_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."extracted_certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD CONSTRAINT "certificate_merge_job_inputs_signed_artifact_id_certificate_signed_artifacts_id_fk" FOREIGN KEY ("signed_artifact_id") REFERENCES "public"."certificate_signed_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD CONSTRAINT "certificate_merge_job_inputs_merge_assignment_id_certificate_merge_assignments_id_fk" FOREIGN KEY ("merge_assignment_id") REFERENCES "public"."certificate_merge_assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_merge_job_outputs" ADD CONSTRAINT "certificate_merge_job_outputs_merge_job_id_certificate_merge_jobs_id_fk" FOREIGN KEY ("merge_job_id") REFERENCES "public"."certificate_merge_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_merge_job_outputs" ADD CONSTRAINT "certificate_merge_job_outputs_first_downloaded_by_user_id_user_id_fk" FOREIGN KEY ("first_downloaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_merge_jobs" ADD CONSTRAINT "certificate_merge_jobs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_override_changes" ADD CONSTRAINT "certificate_override_changes_request_id_certificate_override_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."certificate_override_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_override_changes" ADD CONSTRAINT "certificate_override_changes_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_override_changes" ADD CONSTRAINT "certificate_override_changes_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_override_requests" ADD CONSTRAINT "certificate_override_requests_certificate_id_extracted_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."extracted_certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_override_requests" ADD CONSTRAINT "certificate_override_requests_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_override_requests" ADD CONSTRAINT "certificate_override_requests_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_signature_templates" ADD CONSTRAINT "certificate_signature_templates_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_signature_templates" ADD CONSTRAINT "certificate_signature_templates_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_signed_artifacts" ADD CONSTRAINT "certificate_signed_artifacts_certificate_id_extracted_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."extracted_certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_signed_artifacts" ADD CONSTRAINT "certificate_signed_artifacts_signed_by_user_id_user_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_signed_artifacts" ADD CONSTRAINT "certificate_signed_artifacts_first_downloaded_by_user_id_user_id_fk" FOREIGN KEY ("first_downloaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_tax_rows" ADD CONSTRAINT "certificate_tax_rows_certificate_id_extracted_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."extracted_certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extraction_attempts" ADD CONSTRAINT "document_extraction_attempts_upload_id_intake_files_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."intake_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_results" ADD CONSTRAINT "document_results_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_results" ADD CONSTRAINT "document_results_upload_id_intake_files_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."intake_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_results" ADD CONSTRAINT "document_results_current_extraction_attempt_id_document_extraction_attempts_id_fk" FOREIGN KEY ("current_extraction_attempt_id") REFERENCES "public"."document_extraction_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_certificates" ADD CONSTRAINT "extracted_certificates_document_result_id_document_results_id_fk" FOREIGN KEY ("document_result_id") REFERENCES "public"."document_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_batches" ADD CONSTRAINT "intake_batches_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_batches" ADD CONSTRAINT "intake_batches_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_batches" ADD CONSTRAINT "intake_batches_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_files" ADD CONSTRAINT "intake_files_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_files" ADD CONSTRAINT "intake_files_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_files" ADD CONSTRAINT "intake_files_removed_from_batch_by_user_id_user_id_fk" FOREIGN KEY ("removed_from_batch_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_result_collections" ADD CONSTRAINT "reconciliation_result_collections_reconciliation_result_id_reconciliation_results_id_fk" FOREIGN KEY ("reconciliation_result_id") REFERENCES "public"."reconciliation_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_result_collections" ADD CONSTRAINT "reconciliation_result_collections_certificate_id_extracted_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."extracted_certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_result_collections" ADD CONSTRAINT "reconciliation_result_collections_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_result_collections" ADD CONSTRAINT "reconciliation_result_collections_upload_id_intake_files_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."intake_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_sales_report_id_sales_reports_id_fk" FOREIGN KEY ("sales_report_id") REFERENCES "public"."sales_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_sales_report_version_id_sales_report_versions_id_fk" FOREIGN KEY ("sales_report_version_id") REFERENCES "public"."sales_report_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_sales_report_run_id_sales_report_runs_id_fk" FOREIGN KEY ("sales_report_run_id") REFERENCES "public"."sales_report_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_sales_report_row_id_sales_report_rows_id_fk" FOREIGN KEY ("sales_report_row_id") REFERENCES "public"."sales_report_rows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_matched_upload_batch_id_intake_batches_id_fk" FOREIGN KEY ("matched_upload_batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_matched_certificate_id_extracted_certificates_id_fk" FOREIGN KEY ("matched_certificate_id") REFERENCES "public"."extracted_certificates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_archived_by_user_id_user_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_artifacts" ADD CONSTRAINT "result_artifacts_document_result_id_document_results_id_fk" FOREIGN KEY ("document_result_id") REFERENCES "public"."document_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_artifacts" ADD CONSTRAINT "result_artifacts_certificate_id_extracted_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."extracted_certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_report_rows" ADD CONSTRAINT "sales_report_rows_sales_report_version_id_sales_report_versions_id_fk" FOREIGN KEY ("sales_report_version_id") REFERENCES "public"."sales_report_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_report_run_batches" ADD CONSTRAINT "sales_report_run_batches_sales_report_run_id_sales_report_runs_id_fk" FOREIGN KEY ("sales_report_run_id") REFERENCES "public"."sales_report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_report_run_batches" ADD CONSTRAINT "sales_report_run_batches_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_report_runs" ADD CONSTRAINT "sales_report_runs_sales_report_id_sales_reports_id_fk" FOREIGN KEY ("sales_report_id") REFERENCES "public"."sales_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_report_runs" ADD CONSTRAINT "sales_report_runs_sales_report_version_id_sales_report_versions_id_fk" FOREIGN KEY ("sales_report_version_id") REFERENCES "public"."sales_report_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_report_runs" ADD CONSTRAINT "sales_report_runs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_report_runs" ADD CONSTRAINT "sales_report_runs_archived_by_user_id_user_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_report_versions" ADD CONSTRAINT "sales_report_versions_sales_report_id_sales_reports_id_fk" FOREIGN KEY ("sales_report_id") REFERENCES "public"."sales_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_report_versions" ADD CONSTRAINT "sales_report_versions_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reports" ADD CONSTRAINT "sales_reports_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reports" ADD CONSTRAINT "sales_reports_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reports" ADD CONSTRAINT "sales_reports_deleted_by_user_id_user_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_signature_profiles" ADD CONSTRAINT "user_signature_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD CONSTRAINT "worker_jobs_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD CONSTRAINT "worker_jobs_upload_id_intake_files_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."intake_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "atc_codes_code_idx" ON "atc_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "user_deleted_at_idx" ON "user" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "batch_stage_timings_batch_stage_idx" ON "batch_stage_timings" USING btree ("batch_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_stage_timings_dedupe_key_idx" ON "batch_stage_timings" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "batch_stage_timings_source_idx" ON "batch_stage_timings" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_merge_assignments_certificate_package_idx" ON "certificate_merge_assignments" USING btree ("certificate_id","package_type");--> statement-breakpoint
CREATE INDEX "certificate_merge_assignments_assigned_period_idx" ON "certificate_merge_assignments" USING btree ("package_type","assigned_year","assigned_quarter","status");--> statement-breakpoint
CREATE INDEX "certificate_merge_assignments_status_idx" ON "certificate_merge_assignments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_merge_job_batches_job_batch_idx" ON "certificate_merge_job_batches" USING btree ("merge_job_id","batch_id");--> statement-breakpoint
CREATE INDEX "certificate_merge_job_batches_batch_idx" ON "certificate_merge_job_batches" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "certificate_merge_job_inputs_job_idx" ON "certificate_merge_job_inputs" USING btree ("merge_job_id","input_order");--> statement-breakpoint
CREATE INDEX "certificate_merge_job_inputs_certificate_idx" ON "certificate_merge_job_inputs" USING btree ("certificate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_merge_job_inputs_job_certificate_idx" ON "certificate_merge_job_inputs" USING btree ("merge_job_id","certificate_id");--> statement-breakpoint
CREATE INDEX "certificate_merge_job_inputs_output_part_idx" ON "certificate_merge_job_inputs" USING btree ("merge_job_id","output_part_number","certificate_id") WHERE "certificate_merge_job_inputs"."output_part_number" is not null;--> statement-breakpoint
CREATE INDEX "certificate_merge_job_outputs_job_idx" ON "certificate_merge_job_outputs" USING btree ("merge_job_id","part_number");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_merge_job_outputs_job_part_idx" ON "certificate_merge_job_outputs" USING btree ("merge_job_id","part_number");--> statement-breakpoint
CREATE INDEX "certificate_merge_job_outputs_first_downloaded_idx" ON "certificate_merge_job_outputs" USING btree ("first_downloaded_at","merge_job_id","part_number") WHERE "certificate_merge_job_outputs"."first_downloaded_at" is not null;--> statement-breakpoint
CREATE INDEX "certificate_merge_jobs_created_by_idx" ON "certificate_merge_jobs" USING btree ("created_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "certificate_merge_jobs_selection_idx" ON "certificate_merge_jobs" USING btree ("payee_short_name","period_type","year","quarter");--> statement-breakpoint
CREATE INDEX "certificate_merge_jobs_batch_job_idx" ON "certificate_merge_jobs" USING btree ("aws_batch_job_id");--> statement-breakpoint
CREATE INDEX "certificate_merge_jobs_status_idx" ON "certificate_merge_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_override_changes_request_field_idx" ON "certificate_override_changes" USING btree ("request_id","field_path");--> statement-breakpoint
CREATE INDEX "certificate_override_changes_status_idx" ON "certificate_override_changes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "certificate_override_requests_certificate_idx" ON "certificate_override_requests" USING btree ("certificate_id");--> statement-breakpoint
CREATE INDEX "certificate_override_requests_status_created_idx" ON "certificate_override_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "certificate_override_requests_requested_by_idx" ON "certificate_override_requests" USING btree ("requested_by_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_override_requests_pending_certificate_idx" ON "certificate_override_requests" USING btree ("certificate_id") WHERE "certificate_override_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_processed_number_counters_payor_month_idx" ON "certificate_processed_number_counters" USING btree ("payor_short_name","upload_month");--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_signed_artifacts_certificate_idx" ON "certificate_signed_artifacts" USING btree ("certificate_id");--> statement-breakpoint
CREATE INDEX "certificate_signed_artifacts_signer_idx" ON "certificate_signed_artifacts" USING btree ("signed_by_user_id");--> statement-breakpoint
CREATE INDEX "certificate_signed_artifacts_first_downloaded_idx" ON "certificate_signed_artifacts" USING btree ("first_downloaded_at","certificate_id") WHERE "certificate_signed_artifacts"."first_downloaded_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_tax_rows_certificate_line_idx" ON "certificate_tax_rows" USING btree ("certificate_id","line_number");--> statement-breakpoint
CREATE INDEX "certificate_tax_rows_certificate_idx" ON "certificate_tax_rows" USING btree ("certificate_id");--> statement-breakpoint
CREATE INDEX "document_extraction_attempts_upload_idx" ON "document_extraction_attempts" USING btree ("upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_extraction_attempts_job_idx" ON "document_extraction_attempts" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_extraction_attempts_event_worker_attempt_idx" ON "document_extraction_attempts" USING btree ("event_id","worker_attempt_number");--> statement-breakpoint
CREATE INDEX "document_extraction_attempts_status_idx" ON "document_extraction_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "document_results_batch_idx" ON "document_results" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_results_upload_idx" ON "document_results" USING btree ("upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_results_current_extraction_attempt_idx" ON "document_results" USING btree ("current_extraction_attempt_id");--> statement-breakpoint
CREATE INDEX "document_results_source_file_revision_idx" ON "document_results" USING btree ("source_file_id","revision");--> statement-breakpoint
CREATE INDEX "document_results_status_idx" ON "document_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "document_results_source_hash_idx" ON "document_results" USING btree ("source_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "extracted_certificates_document_ordinal_idx" ON "extracted_certificates" USING btree ("document_result_id","ordinal");--> statement-breakpoint
CREATE INDEX "extracted_certificates_document_idx" ON "extracted_certificates" USING btree ("document_result_id");--> statement-breakpoint
CREATE INDEX "extracted_certificates_status_idx" ON "extracted_certificates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "extracted_certificates_fingerprint_idx" ON "extracted_certificates" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "extracted_certificates_payee_tin_idx" ON "extracted_certificates" USING btree ("payee_tin");--> statement-breakpoint
CREATE INDEX "extracted_certificates_payor_tin_idx" ON "extracted_certificates" USING btree ("payor_tin");--> statement-breakpoint
CREATE INDEX "extracted_certificates_period_end_idx" ON "extracted_certificates" USING btree ("period_end");--> statement-breakpoint
CREATE INDEX "intake_batches_created_by_status_idx" ON "intake_batches" USING btree ("created_by_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "intake_batches_one_open_per_user_idx" ON "intake_batches" USING btree ("created_by_user_id") WHERE "intake_batches"."status" = 'open';--> statement-breakpoint
CREATE INDEX "intake_batches_last_activity_idx" ON "intake_batches" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "intake_batches_active_last_activity_idx" ON "intake_batches" USING btree ("last_activity_at","created_at") WHERE "intake_batches"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "intake_batches_deleted_at_idx" ON "intake_batches" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "intake_batches_purge_after_idx" ON "intake_batches" USING btree ("purge_after_at") WHERE "intake_batches"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "intake_batches_entity_id_idx" ON "intake_batches" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "intake_batches_entity_short_name_idx" ON "intake_batches" USING btree ("entity_short_name");--> statement-breakpoint
CREATE INDEX "intake_batches_entity_company_name_idx" ON "intake_batches" USING btree ("entity_company_name");--> statement-breakpoint
CREATE INDEX "intake_files_batch_idx" ON "intake_files" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "intake_files_batch_removed_idx" ON "intake_files" USING btree ("batch_id","removed_from_batch_at");--> statement-breakpoint
CREATE INDEX "intake_files_event_id_idx" ON "intake_files" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "intake_files_original_file_name_idx" ON "intake_files" USING btree ("original_file_name");--> statement-breakpoint
CREATE INDEX "intake_files_source_file_revision_idx" ON "intake_files" USING btree ("source_file_id","revision");--> statement-breakpoint
CREATE INDEX "intake_files_certificate_issuer_billing_month_idx" ON "intake_files" USING btree ("certificate_issuer_short_name_normalized","certificate_billing_month_mmyy","uploaded_at");--> statement-breakpoint
CREATE INDEX "intake_files_dashboard_upload_date_idx" ON "intake_files" USING btree ((coalesce("uploaded_at", "created_at"))) WHERE "intake_files"."removed_from_batch_at" is null;--> statement-breakpoint
CREATE INDEX "intake_files_dashboard_upload_type_date_idx" ON "intake_files" USING btree ("certificate_document_type",(coalesce("uploaded_at", "created_at"))) WHERE "intake_files"."removed_from_batch_at" is null;--> statement-breakpoint
CREATE INDEX "reconciliation_result_collections_result_idx" ON "reconciliation_result_collections" USING btree ("reconciliation_result_id");--> statement-breakpoint
CREATE INDEX "reconciliation_result_collections_certificate_idx" ON "reconciliation_result_collections" USING btree ("certificate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_result_collections_active_certificate_idx" ON "reconciliation_result_collections" USING btree ("certificate_id") WHERE "reconciliation_result_collections"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "reconciliation_result_collections_batch_idx" ON "reconciliation_result_collections" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "reconciliation_result_collections_active_result_idx" ON "reconciliation_result_collections" USING btree ("reconciliation_result_id","applied_at") WHERE "reconciliation_result_collections"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "reconciliation_result_collections_archived_at_idx" ON "reconciliation_result_collections" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "reconciliation_results_upload_batch_idx" ON "reconciliation_results" USING btree ("upload_batch_id");--> statement-breakpoint
CREATE INDEX "reconciliation_results_matched_certificate_idx" ON "reconciliation_results" USING btree ("matched_certificate_id");--> statement-breakpoint
CREATE INDEX "reconciliation_results_created_at_idx" ON "reconciliation_results" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reconciliation_results_matched_at_idx" ON "reconciliation_results" USING btree ("matched_at");--> statement-breakpoint
CREATE INDEX "reconciliation_results_requesting_entity_short_name_idx" ON "reconciliation_results" USING btree ("requesting_entity_short_name");--> statement-breakpoint
CREATE INDEX "reconciliation_results_sales_report_active_idx" ON "reconciliation_results" USING btree ("sales_report_id","sales_report_run_id","created_at") WHERE "reconciliation_results"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "reconciliation_results_sales_report_run_idx" ON "reconciliation_results" USING btree ("sales_report_run_id");--> statement-breakpoint
CREATE INDEX "reconciliation_results_sales_report_row_idx" ON "reconciliation_results" USING btree ("sales_report_row_id");--> statement-breakpoint
CREATE INDEX "reconciliation_results_matched_upload_batch_idx" ON "reconciliation_results" USING btree ("matched_upload_batch_id");--> statement-breakpoint
CREATE INDEX "reconciliation_results_archived_at_idx" ON "reconciliation_results" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "reconciliation_results_dashboard_unmatched_created_idx" ON "reconciliation_results" USING btree ("created_at") WHERE "reconciliation_results"."matched_certificate_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "result_artifacts_bucket_key_idx" ON "result_artifacts" USING btree ("bucket","key");--> statement-breakpoint
CREATE INDEX "result_artifacts_document_idx" ON "result_artifacts" USING btree ("document_result_id");--> statement-breakpoint
CREATE INDEX "result_artifacts_certificate_idx" ON "result_artifacts" USING btree ("certificate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_report_rows_version_row_idx" ON "sales_report_rows" USING btree ("sales_report_version_id","row_number");--> statement-breakpoint
CREATE INDEX "sales_report_rows_version_idx" ON "sales_report_rows" USING btree ("sales_report_version_id");--> statement-breakpoint
CREATE INDEX "sales_report_rows_tin_idx" ON "sales_report_rows" USING btree ("tin");--> statement-breakpoint
CREATE INDEX "sales_report_rows_invoice_idx" ON "sales_report_rows" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "sales_report_rows_customer_idx" ON "sales_report_rows" USING btree ("customer_name");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_report_run_batches_run_batch_idx" ON "sales_report_run_batches" USING btree ("sales_report_run_id","batch_id");--> statement-breakpoint
CREATE INDEX "sales_report_run_batches_batch_idx" ON "sales_report_run_batches" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "sales_report_runs_report_status_created_idx" ON "sales_report_runs" USING btree ("sales_report_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sales_report_runs_active_report_idx" ON "sales_report_runs" USING btree ("sales_report_id","created_at") WHERE "sales_report_runs"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_report_versions_report_version_idx" ON "sales_report_versions" USING btree ("sales_report_id","version_number");--> statement-breakpoint
CREATE INDEX "sales_report_versions_report_created_idx" ON "sales_report_versions" USING btree ("sales_report_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_report_versions_parse_status_idx" ON "sales_report_versions" USING btree ("parse_status");--> statement-breakpoint
CREATE INDEX "sales_reports_entity_status_updated_idx" ON "sales_reports" USING btree ("entity_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "sales_reports_created_by_updated_idx" ON "sales_reports" USING btree ("created_by_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "sales_reports_deleted_at_idx" ON "sales_reports" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "security_audit_logs_occurred_at_idx" ON "security_audit_logs" USING btree ("occurredAt");--> statement-breakpoint
CREATE INDEX "security_audit_logs_event_type_idx" ON "security_audit_logs" USING btree ("eventType");--> statement-breakpoint
CREATE INDEX "security_audit_logs_actor_user_id_idx" ON "security_audit_logs" USING btree ("actorUserId");--> statement-breakpoint
CREATE INDEX "security_audit_logs_target_type_idx" ON "security_audit_logs" USING btree ("targetType");--> statement-breakpoint
CREATE INDEX "worker_job_steps_job_idx" ON "worker_job_steps" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "worker_jobs_batch_idx" ON "worker_jobs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "worker_jobs_upload_idx" ON "worker_jobs" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "worker_jobs_event_idx" ON "worker_jobs" USING btree ("event_id");--> statement-breakpoint
CREATE OR REPLACE VIEW "certificate_results_view" AS
SELECT
	"certificate"."id",
	"certificate"."document_result_id",
	"document_result"."job_id",
	"document_result"."event_id",
	"document_result"."batch_id",
	"batch"."entity_id",
	"batch"."entity_short_name",
	"document_result"."upload_id",
	"document_result"."source_file_id",
	"document_result"."revision",
	"document_result"."source_hash",
	"document_result"."status" AS "document_status",
	"document_result"."document_type",
	"certificate"."status",
	"certificate"."ordinal",
	"certificate"."certificate_key",
	"certificate"."page_numbers",
	"certificate"."period_start",
	"certificate"."period_end",
	"certificate"."month_of_quarter",
	"certificate"."payee_name",
	"certificate"."payee_tin",
	"certificate"."payee_address",
	"certificate"."payee_zip",
	"certificate"."payee_short_name",
	"certificate"."payor_name",
	"certificate"."payor_tin",
	"certificate"."payor_address",
	"certificate"."payor_zip",
	"certificate"."payor_short_name",
	"certificate"."primary_atc_code",
	"certificate"."total_tax_base",
	"certificate"."total_tax_withheld",
	"certificate"."signer_printed_name",
	"certificate"."signer_title",
	"certificate"."signer_tin",
	"certificate"."signer_company_name",
	"certificate"."signature_present",
	"certificate"."signature_confidence",
	"certificate"."signature_page_number",
	"certificate"."signature_source",
	"certificate"."validation_status",
	"certificate"."reason_codes",
	"certificate"."validation_summary",
	"certificate"."masterlist_resolution",
	"certificate"."confidence_summary",
	"certificate"."fingerprint",
	"document_result"."payload" -> 'extraction' -> 'certificates' -> ("certificate"."ordinal" - 1) AS "immutable_extraction",
	"certificate_artifact"."key" AS "artifact_key",
	"intake_file"."original_file_name",
	"certificate"."created_at",
	"certificate"."updated_at"
FROM "extracted_certificates" AS "certificate"
INNER JOIN "document_results" AS "document_result"
	ON "document_result"."id" = "certificate"."document_result_id"
INNER JOIN "intake_files" AS "intake_file"
	ON "intake_file"."id" = "document_result"."upload_id"
INNER JOIN "intake_batches" AS "batch"
	ON "batch"."id" = "document_result"."batch_id"
LEFT JOIN LATERAL (
	SELECT "artifact"."key"
	FROM "result_artifacts" AS "artifact"
	WHERE "artifact"."certificate_id" = "certificate"."id"
		AND "artifact"."role" = 'certificate_pdf'
	ORDER BY "artifact"."created_at" DESC, "artifact"."id" DESC
	LIMIT 1
) AS "certificate_artifact" ON true;
