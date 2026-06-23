CREATE TABLE "certificate_merge_job_batches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "certificate_merge_job_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"merge_job_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_batches" ADD CONSTRAINT "certificate_merge_job_batches_merge_job_id_certificate_merge_jobs_id_fk" FOREIGN KEY ("merge_job_id") REFERENCES "public"."certificate_merge_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate_merge_job_batches" ADD CONSTRAINT "certificate_merge_job_batches_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_merge_job_batches_job_batch_idx" ON "certificate_merge_job_batches" USING btree ("merge_job_id","batch_id");
--> statement-breakpoint
CREATE INDEX "certificate_merge_job_batches_batch_idx" ON "certificate_merge_job_batches" USING btree ("batch_id");
