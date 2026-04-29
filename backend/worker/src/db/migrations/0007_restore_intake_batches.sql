CREATE TABLE "intake_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"total_files" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intake_files" ADD COLUMN "batch_id" uuid;
--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD COLUMN "batch_id" uuid;
--> statement-breakpoint
ALTER TABLE "document_results" ADD COLUMN "batch_id" uuid;
--> statement-breakpoint
ALTER TABLE "intake_files" ALTER COLUMN "batch_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "worker_jobs" ALTER COLUMN "batch_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "document_results" ALTER COLUMN "batch_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "intake_files" ADD CONSTRAINT "intake_files_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "worker_jobs" ADD CONSTRAINT "worker_jobs_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_results" ADD CONSTRAINT "document_results_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "intake_batches_created_by_status_idx" ON "intake_batches" USING btree ("created_by_user_id","status");
--> statement-breakpoint
CREATE INDEX "intake_batches_last_activity_idx" ON "intake_batches" USING btree ("last_activity_at");
--> statement-breakpoint
CREATE INDEX "intake_files_batch_idx" ON "intake_files" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX "worker_jobs_batch_idx" ON "worker_jobs" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX "document_results_batch_idx" ON "document_results" USING btree ("batch_id");
