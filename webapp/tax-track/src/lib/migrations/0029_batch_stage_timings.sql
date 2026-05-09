CREATE TABLE "batch_stage_timings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
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
ALTER TABLE "batch_stage_timings" ADD CONSTRAINT "batch_stage_timings_batch_id_intake_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "batch_stage_timings_batch_stage_idx" ON "batch_stage_timings" USING btree ("batch_id","stage");
--> statement-breakpoint
CREATE UNIQUE INDEX "batch_stage_timings_dedupe_key_idx" ON "batch_stage_timings" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE INDEX "batch_stage_timings_source_idx" ON "batch_stage_timings" USING btree ("source_type","source_id");
