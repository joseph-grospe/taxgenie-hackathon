UPDATE "user"
SET "emailVerified" = true,
    "updatedAt" = now()
WHERE "emailVerified" = false;
--> statement-breakpoint
