WITH desired_reconciliation_status AS (
  SELECT
    rr."id",
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM "reconciliation_result_collections" rrc
        WHERE rrc."reconciliation_result_id" = rr."id"
          AND rrc."archived_at" IS NULL
      ) AND rr."has_difference" = false THEN 'matched'
      ELSE 'unmatched'
    END AS "match_status",
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM "reconciliation_result_collections" rrc
        WHERE rrc."reconciliation_result_id" = rr."id"
          AND rrc."archived_at" IS NULL
      ) AND rr."has_difference" = false
        THEN coalesce(rr."matched_at", rr."updated_at", rr."created_at", now())
      ELSE NULL
    END AS "matched_at"
  FROM "reconciliation_results" rr
  WHERE rr."archived_at" IS NULL
)
UPDATE "reconciliation_results" rr
SET
  "match_status" = desired."match_status",
  "matched_at" = desired."matched_at",
  "updated_at" = now()
FROM desired_reconciliation_status desired
WHERE rr."id" = desired."id"
  AND (
    rr."match_status" IS DISTINCT FROM desired."match_status"
    OR rr."matched_at" IS DISTINCT FROM desired."matched_at"
  );
--> statement-breakpoint
WITH active_run_summaries AS (
  SELECT
    rr."sales_report_run_id",
    count(*) FILTER (WHERE rr."match_status" = 'matched')::int AS "matched_count",
    count(*) FILTER (WHERE rr."match_status" = 'unmatched')::int AS "unmatched_count",
    coalesce(
      sum(abs(rr."tax_base_difference") + abs(rr."tax_withheld_difference")),
      0
    )::double precision AS "variance_total"
  FROM "reconciliation_results" rr
  WHERE rr."archived_at" IS NULL
    AND rr."sales_report_run_id" IS NOT NULL
  GROUP BY rr."sales_report_run_id"
)
UPDATE "sales_report_runs" srr
SET
  "matched_count" = summary."matched_count",
  "unmatched_count" = summary."unmatched_count",
  "variance_total" = summary."variance_total",
  "updated_at" = now()
FROM active_run_summaries summary
WHERE srr."id" = summary."sales_report_run_id"
  AND srr."archived_at" IS NULL
  AND (
    srr."matched_count" IS DISTINCT FROM summary."matched_count"
    OR srr."unmatched_count" IS DISTINCT FROM summary."unmatched_count"
    OR srr."variance_total" IS DISTINCT FROM summary."variance_total"
  );
