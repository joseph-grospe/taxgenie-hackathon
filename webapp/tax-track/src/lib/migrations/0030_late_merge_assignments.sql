CREATE TABLE "certificate_merge_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_result_id" integer NOT NULL,
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
ALTER TABLE "certificate_merge_assignments" ADD CONSTRAINT "certificate_merge_assignments_document_result_id_document_results_id_fk" FOREIGN KEY ("document_result_id") REFERENCES "public"."document_results"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_merge_assignments" ADD CONSTRAINT "certificate_merge_assignments_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_merge_assignments_document_package_idx" ON "certificate_merge_assignments" USING btree ("document_result_id","package_type");
--> statement-breakpoint
CREATE INDEX "certificate_merge_assignments_assigned_period_idx" ON "certificate_merge_assignments" USING btree ("package_type","assigned_year","assigned_quarter","status");
--> statement-breakpoint
CREATE INDEX "certificate_merge_assignments_status_idx" ON "certificate_merge_assignments" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD COLUMN "merge_assignment_id" uuid;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD COLUMN "source_package_type" varchar(16);
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD COLUMN "source_year" integer;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD COLUMN "source_quarter" integer;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD COLUMN "assigned_year" integer;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD COLUMN "assigned_quarter" integer;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD COLUMN "is_late" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD COLUMN "assignment_reason" text;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_inputs" ADD CONSTRAINT "certificate_merge_job_inputs_merge_assignment_id_certificate_merge_assignments_id_fk" FOREIGN KEY ("merge_assignment_id") REFERENCES "public"."certificate_merge_assignments"("id") ON DELETE set null ON UPDATE no action;
