WITH "primary_atc_totals" AS (
	SELECT
		"certificate"."id" AS "certificate_id",
		CASE
			WHEN count(*) = count("tax_row"."tax_base")
				THEN sum("tax_row"."tax_base")
			ELSE NULL
		END AS "total_tax_base",
		CASE
			WHEN count(*) = count("tax_row"."tax_withheld")
				THEN sum("tax_row"."tax_withheld")
			ELSE NULL
		END AS "total_tax_withheld"
	FROM "extracted_certificates" AS "certificate"
	INNER JOIN "certificate_tax_rows" AS "tax_row"
		ON "tax_row"."certificate_id" = "certificate"."id"
		AND regexp_replace(
			upper(coalesce("tax_row"."atc_code", '')),
			'[^A-Z0-9]',
			'',
			'g'
		) = regexp_replace(
			upper(coalesce("certificate"."primary_atc_code", '')),
			'[^A-Z0-9]',
			'',
			'g'
		)
	WHERE regexp_replace(
		upper(coalesce("certificate"."primary_atc_code", '')),
		'[^A-Z0-9]',
		'',
		'g'
	) <> ''
	GROUP BY "certificate"."id"
)
UPDATE "extracted_certificates" AS "certificate"
SET
	"total_tax_base" = coalesce(
		"certificate"."total_tax_base",
		"primary_atc_totals"."total_tax_base"
	),
	"total_tax_withheld" = coalesce(
		"certificate"."total_tax_withheld",
		"primary_atc_totals"."total_tax_withheld"
	),
	"updated_at" = CASE
		WHEN (
			"certificate"."total_tax_base" IS NULL
			AND "primary_atc_totals"."total_tax_base" IS NOT NULL
		) OR (
			"certificate"."total_tax_withheld" IS NULL
			AND "primary_atc_totals"."total_tax_withheld" IS NOT NULL
		)
			THEN now()
		ELSE "certificate"."updated_at"
	END
FROM "primary_atc_totals"
WHERE "certificate"."id" = "primary_atc_totals"."certificate_id"
	AND (
		"certificate"."total_tax_base" IS NULL
		OR "certificate"."total_tax_withheld" IS NULL
	);
