-- Promote the oldest non-deleted user to seeded super admin.
-- Intended for manual execution in dev/UAT only.
--
-- Optional preview:
-- SELECT id, email, name, role, "createdAt"
-- FROM "user"
-- WHERE "deletedAt" IS NULL
-- ORDER BY "createdAt" ASC, id ASC
-- LIMIT 1;

BEGIN;

WITH oldest_user AS (
  SELECT id
  FROM "user"
  WHERE "deletedAt" IS NULL
  ORDER BY "createdAt" ASC, id ASC
  LIMIT 1
  FOR UPDATE
),
demoted_users AS (
  UPDATE "user"
  SET role = 'admin',
      "updatedAt" = now()
  WHERE role = 'super_admin'
    AND id <> (SELECT id FROM oldest_user)
  RETURNING id, email, name, role, "canExportPdf", "canExportExcel", "updatedAt"
),
promoted_user AS (
  UPDATE "user"
  SET role = 'super_admin',
      "canExportPdf" = true,
      "canExportExcel" = true,
      "updatedAt" = now()
  WHERE id = (SELECT id FROM oldest_user)
  RETURNING id, email, name, role, "canExportPdf", "canExportExcel", "updatedAt"
)
SELECT 'promoted' AS action,
       id,
       email,
       name,
       role,
       "canExportPdf",
       "canExportExcel",
       "updatedAt"
FROM promoted_user
UNION ALL
SELECT 'demoted' AS action,
       id,
       email,
       name,
       role,
       "canExportPdf",
       "canExportExcel",
       "updatedAt"
FROM demoted_users
ORDER BY action, email;

COMMIT;
