ALTER TABLE "document_results" DROP CONSTRAINT "document_results_status_check";--> statement-breakpoint
ALTER TABLE "extracted_certificates" DROP CONSTRAINT "extracted_certificates_status_check";--> statement-breakpoint
ALTER TABLE "extracted_certificates" DROP CONSTRAINT "extracted_certificates_validation_status_check";--> statement-breakpoint
ALTER TABLE "document_results" ADD CONSTRAINT "document_results_status_check" CHECK ("document_results"."status" in ('accepted', 'manual_review', 'error', 'duplicate'));--> statement-breakpoint
ALTER TABLE "extracted_certificates" ADD CONSTRAINT "extracted_certificates_status_check" CHECK ("extracted_certificates"."status" in ('accepted', 'manual_review', 'error', 'duplicate'));--> statement-breakpoint
ALTER TABLE "extracted_certificates" ADD CONSTRAINT "extracted_certificates_validation_status_check" CHECK ("extracted_certificates"."validation_status" in ('valid', 'manual_review', 'invalid'));