DO $$ BEGIN
 IF EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'intake_files'
     AND column_name = 'removed_from_session_at'
 ) AND NOT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'intake_files'
     AND column_name = 'removed_from_batch_at'
 ) THEN
   ALTER TABLE "intake_files" RENAME COLUMN "removed_from_session_at" TO "removed_from_batch_at";
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'intake_files'
     AND column_name = 'removed_from_session_by_user_id'
 ) AND NOT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'intake_files'
     AND column_name = 'removed_from_batch_by_user_id'
 ) THEN
   ALTER TABLE "intake_files" RENAME COLUMN "removed_from_session_by_user_id" TO "removed_from_batch_by_user_id";
 END IF;
END $$;
