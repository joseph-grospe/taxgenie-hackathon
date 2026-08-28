CREATE TABLE IF NOT EXISTS "atc_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"tax_type" text NOT NULL,
	"code" varchar(32) NOT NULL,
	"description" text NOT NULL,
	"rate" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "atc_codes_code_normalized_check" CHECK ("code" = regexp_replace(upper(trim("code")), '[^A-Z0-9]', '', 'g') AND length("code") > 0),
	CONSTRAINT "atc_codes_rate_positive_check" CHECK ("rate" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "atc_codes_code_idx" ON "atc_codes" USING btree ("code");
--> statement-breakpoint
INSERT INTO "atc_codes" ("tax_type", "code", "description", "rate")
VALUES
	('WE', 'WC160', 'Income Payment made by top withholding agents to their local/resident suppliers of services other than those covered by other rates of withholding tax', 0.02),
	('WE', 'WC158', 'Income Payment made by top withholding agents to their local/resident suppliers of goods other than those covered by other rates of withholding tax', 0.01),
	('WE', 'WC051', 'Management and technical consultants', 0.15)
ON CONFLICT ("code") DO NOTHING;
