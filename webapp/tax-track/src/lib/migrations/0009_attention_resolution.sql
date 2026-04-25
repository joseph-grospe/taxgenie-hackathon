ALTER TABLE "intake_files"
ADD COLUMN "attention_status" varchar(32) NOT NULL DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "intake_files"
ADD COLUMN "attention_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intake_files"
ADD COLUMN "attention_resolved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "intake_files"
ADD CONSTRAINT "intake_files_attention_resolved_by_user_id_user_id_fk"
FOREIGN KEY ("attention_resolved_by_user_id") REFERENCES "public"."user"("id")
ON DELETE restrict ON UPDATE no action;
