#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "Usage: $0 <backup-directory>" >&2
  exit 1
fi

if [[ "${TAXTRACK_RESTORE_CONFIRM:-}" != "RESTORE_UAT_REFERENCE_DATA" ]]; then
  echo "Set TAXTRACK_RESTORE_CONFIRM=RESTORE_UAT_REFERENCE_DATA to continue." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE_INPUT="${TAXTRACK_ENV_FILE:-${ROOT_DIR}/.env.uat}"

if [[ "${ENV_FILE_INPUT}" = /* ]]; then
  ENV_FILE="${ENV_FILE_INPUT}"
else
  ENV_FILE="${ROOT_DIR}/${ENV_FILE_INPUT}"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Environment file not found: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

BACKUP_DIR="$(cd "$1" && pwd)"
PG_IMAGE="${TAXTRACK_PG_IMAGE:-postgres:18}"

DB_HOST="${TAXTRACK_RESTORE_HOST:-127.0.0.1}"
DB_PORT="${TAXTRACK_RESTORE_PORT:-${TAXTRACK_DB_TUNNEL_LOCAL_PORT:-15432}}"
DB_NAME="${TAXTRACK_RESTORE_DATABASE:-taxtrack}"
DB_USER="${TAXTRACK_RESTORE_USER:-taxtrack}"
DB_PASSWORD="${TAXTRACK_RESTORE_PASSWORD:-${TAXTRACK_DB_PASSWORD:-}}"
DB_SSLMODE="${TAXTRACK_RESTORE_SSLMODE:-require}"

if [[ -z "${DB_PASSWORD}" ]]; then
  echo "TAXTRACK_DB_PASSWORD is required." >&2
  exit 1
fi

if [[ -f "${BACKUP_DIR}/INCOMPLETE" ]]; then
  echo "The selected backup is marked incomplete." >&2
  exit 1
fi

shopt -s nullglob
archives=("${BACKUP_DIR}"/*.dump)
shopt -u nullglob

if [[ "${#archives[@]}" -ne 1 ]]; then
  echo "Expected exactly one .dump file in ${BACKUP_DIR}." >&2
  exit 1
fi

ARCHIVE_PATH="${archives[0]}"
ARCHIVE_NAME="$(basename "${ARCHIVE_PATH}")"
EXPECTED_COUNTS="${BACKUP_DIR}/row-counts-before.tsv"

if [[ ! -f "${EXPECTED_COUNTS}" ]]; then
  echo "Missing expected row counts: ${EXPECTED_COUNTS}" >&2
  exit 1
fi

echo "Verifying backup checksums..."
(
  cd "${BACKUP_DIR}"
  shasum -a 256 -c SHA256SUMS
)

CONTAINER_DB_HOST="${DB_HOST}"
if [[ "${DB_HOST}" == "127.0.0.1" || "${DB_HOST}" == "localhost" ]]; then
  CONTAINER_DB_HOST="host.docker.internal"
fi

run_psql() {
  docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    -e "PGPASSWORD=${DB_PASSWORD}" \
    -e "PGSSLMODE=${DB_SSLMODE}" \
    "${PG_IMAGE}" \
    psql \
      -X \
      -v ON_ERROR_STOP=1 \
      -h "${CONTAINER_DB_HOST}" \
      -p "${DB_PORT}" \
      -U "${DB_USER}" \
      -d "${DB_NAME}" \
      "$@"
}

echo "Checking target baseline..."

BASELINE_COUNT="$(
  run_psql -At -c "
    select count(*)
    from public.__drizzle_migrations
    where created_at in (1785221451992, 1785234408115);
  "
)"

if [[ "${BASELINE_COUNT}" != "2" ]]; then
  echo "The target does not have the expected squashed baseline migrations." >&2
  exit 1
fi

TABLE_COUNT="$(
  run_psql -At -c "
    select count(*)
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'user',
        'account',
        'user_signature_profiles',
        'entities',
        'masterlist',
        'atc_codes',
        'document_results'
      );
  "
)"

if [[ "${TABLE_COUNT}" != "7" ]]; then
  echo "The target schema is incomplete. Expected baseline tables are missing." >&2
  exit 1
fi

NON_EMPTY_COUNT="$(
  run_psql -At -c "
    select count(*)
    from (
      select count(*) as row_count from public.\"user\"
      union all select count(*) from public.account
      union all select count(*) from public.user_signature_profiles
      union all select count(*) from public.entities
      union all select count(*) from public.masterlist
      union all select count(*) from public.atc_codes
    ) counts
    where row_count <> 0;
  "
)"

if [[ "${NON_EMPTY_COUNT}" != "0" ]]; then
  echo "Restore aborted: one or more target tables already contain data." >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d)"
ARCHIVE_LIST="${TEMP_DIR}/archive-list.txt"
RESTORE_LIST="${TEMP_DIR}/restore-list.txt"
ACTUAL_COUNTS="${TEMP_DIR}/actual-counts.tsv"

cleanup() {
  [[ -f "${ARCHIVE_LIST}" ]] && rm "${ARCHIVE_LIST}"
  [[ -f "${RESTORE_LIST}" ]] && rm "${RESTORE_LIST}"
  [[ -f "${ACTUAL_COUNTS}" ]] && rm "${ACTUAL_COUNTS}"
  rmdir "${TEMP_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

docker run --rm \
  -v "${BACKUP_DIR}:/backup:ro" \
  "${PG_IMAGE}" \
  pg_restore --list "/backup/${ARCHIVE_NAME}" \
  >"${ARCHIVE_LIST}"

# Restore user first so account and signature-profile foreign keys succeed.
awk '
/TABLE DATA public user / { user_data=$0 }
/TABLE DATA public account / { account_data=$0 }
/TABLE DATA public user_signature_profiles / { profile_data=$0 }
/TABLE DATA public entities / { entities_data=$0 }
/TABLE DATA public masterlist / { masterlist_data=$0 }
/TABLE DATA public atc_codes / { atc_data=$0 }
END {
  print user_data
  print account_data
  print profile_data
  print entities_data
  print masterlist_data
  print atc_data
}
' "${ARCHIVE_LIST}" >"${RESTORE_LIST}"

if [[ "$(grep -c 'TABLE DATA' "${RESTORE_LIST}")" != "6" ]]; then
  echo "Archive does not contain all required table-data entries." >&2
  exit 1
fi

echo "Restoring UAT reference data..."

docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e "PGPASSWORD=${DB_PASSWORD}" \
  -e "PGSSLMODE=${DB_SSLMODE}" \
  -v "${BACKUP_DIR}:/backup:ro" \
  -v "${TEMP_DIR}:/restore:ro" \
  "${PG_IMAGE}" \
  pg_restore \
    -h "${CONTAINER_DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --data-only \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    --single-transaction \
    --use-list=/restore/restore-list.txt \
    "/backup/${ARCHIVE_NAME}"

echo "Resetting identity sequences..."

run_psql -c "
  select setval(
    pg_get_serial_sequence('public.entities', 'id'),
    coalesce((select max(id) from public.entities), 1),
    exists(select 1 from public.entities)
  );

  select setval(
    pg_get_serial_sequence('public.atc_codes', 'id'),
    coalesce((select max(id) from public.atc_codes), 1),
    exists(select 1 from public.atc_codes)
  );
" >/dev/null

printf 'table_name\trow_count\n' >"${ACTUAL_COUNTS}"

run_psql -At -F $'\t' -c "
  select table_name, row_count
  from (
    select 'account'::text as table_name, count(*)::bigint as row_count
      from public.account
    union all select 'atc_codes', count(*) from public.atc_codes
    union all select 'entities', count(*) from public.entities
    union all select 'masterlist', count(*) from public.masterlist
    union all select 'user', count(*) from public.\"user\"
    union all select 'user_signature_profiles', count(*)
      from public.user_signature_profiles
  ) counts
  order by table_name;
" >>"${ACTUAL_COUNTS}"

if ! cmp -s "${EXPECTED_COUNTS}" "${ACTUAL_COUNTS}"; then
  echo "Restore completed, but row-count verification failed." >&2
  diff "${EXPECTED_COUNTS}" "${ACTUAL_COUNTS}" || true
  exit 1
fi

echo
echo "Restore completed and verified successfully."
cat "${ACTUAL_COUNTS}"