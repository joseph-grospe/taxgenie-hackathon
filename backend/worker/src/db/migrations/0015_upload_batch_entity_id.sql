ALTER TABLE "intake_batches" ADD COLUMN IF NOT EXISTS "entity_id" integer;--> statement-breakpoint
ALTER TABLE "intake_batches" ADD CONSTRAINT "intake_batches_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;
