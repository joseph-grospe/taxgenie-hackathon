ALTER TABLE "certificate_tax_rows" ALTER COLUMN "atc_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_tax_rows" ALTER COLUMN "tax_base" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_tax_rows" ALTER COLUMN "tax_rate" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_tax_rows" ALTER COLUMN "tax_withheld" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_certificates" ALTER COLUMN "period_start" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_certificates" ALTER COLUMN "period_end" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_certificates" ALTER COLUMN "month_of_quarter" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_certificates" ALTER COLUMN "payee_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_certificates" ALTER COLUMN "payee_tin" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_certificates" ALTER COLUMN "payor_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_certificates" ALTER COLUMN "payor_tin" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_certificates" ALTER COLUMN "primary_atc_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_certificates" ALTER COLUMN "total_tax_base" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "extracted_certificates" ALTER COLUMN "total_tax_withheld" DROP NOT NULL;
