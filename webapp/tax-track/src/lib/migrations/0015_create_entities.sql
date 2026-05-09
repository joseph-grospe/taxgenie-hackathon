CREATE TABLE "entities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"short_name" text,
	"company_name" text,
	"bir_registered_address" text,
	"zip_code" text,
	"tin" text,
	"email_address" text,
	"region_email_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
