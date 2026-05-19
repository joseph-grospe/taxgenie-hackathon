ALTER TABLE "user" ADD COLUMN "deletedAt" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deletedByUserId" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deletedReason" text;
--> statement-breakpoint
CREATE INDEX "user_deleted_at_idx" ON "user" USING btree ("deletedAt");
