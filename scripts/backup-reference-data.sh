#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  TAXTRACK_ENV_FILE=.env.uat pnpm db:backup:reference

Creates and verifies a timestamped PostgreSQL archive containing:
  public.user
  public.account
  public.user_signature_profiles
  public.entities
  public.masterlist
  public.atc_codes

The private RDS tunnel must already be running. By default, the backup connects
to 127.0.0.1 using TAXTRACK_DB_TUNNEL_LOCAL_PORT and TAXTRACK_DB_PASSWORD from
the selected env file.

Optional environment:
  TAXTRACK_BACKUP_HOST       Defaults to 127.0.0.1
  TAXTRACK_BACKUP_PORT       Defaults to TAXTRACK_DB_TUNNEL_LOCAL_PORT or 15432
  TAXTRACK_BACKUP_DATABASE   Defaults to TAXTRACK_DB_TUNNEL_DATABASE or taxtrack
  TAXTRACK_BACKUP_USER       Defaults to TAXTRACK_DB_TUNNEL_USER or taxtrack
  TAXTRACK_BACKUP_PASSWORD   Defaults to TAXTRACK_DB_PASSWORD
  TAXTRACK_BACKUP_SSLMODE    Defaults to require
  TAXTRACK_BACKUP_STAGE      Defaults to SST_STAGE or unknown
  TAXTRACK_BACKUP_ROOT       Defaults to <repository>/backups
  TAXTRACK_PG_IMAGE          Defaults to postgres:18
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "$#" -gt 0 ]]; then
  usage >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE_INPUT="${TAXTRACK_ENV_FILE:-${ROOT_DIR}/.env}"

if [[ "${ENV_FILE_INPUT}" = /* ]]; then
  ENV_FILE="${ENV_FILE_INPUT}"
else
  ENV_FILE="${ROOT_DIR}/${ENV_FILE_INPUT}"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Could not find env file at ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

SOURCE_HOST="${TAXTRACK_BACKUP_HOST:-127.0.0.1}"
SOURCE_PORT="${TAXTRACK_BACKUP_PORT:-${TAXTRACK_DB_TUNNEL_LOCAL_PORT:-15432}}"
SOURCE_DATABASE="${TAXTRACK_BACKUP_DATABASE:-${TAXTRACK_DB_TUNNEL_DATABASE:-taxtrack}}"
SOURCE_USER="${TAXTRACK_BACKUP_USER:-${TAXTRACK_DB_TUNNEL_USER:-taxtrack}}"
SOURCE_PASSWORD="${TAXTRACK_BACKUP_PASSWORD:-${TAXTRACK_DB_PASSWORD:-}}"
SOURCE_SSLMODE="${TAXTRACK_BACKUP_SSLMODE:-require}"
BACKUP_STAGE="${TAXTRACK_BACKUP_STAGE:-${SST_STAGE:-unknown}}"
BACKUP_ROOT="${TAXTRACK_BACKUP_ROOT:-${ROOT_DIR}/backups}"
PG_IMAGE="${TAXTRACK_PG_IMAGE:-postgres:18}"

if [[ -z "${SOURCE_PASSWORD}" ]]; then
  echo "TAXTRACK_BACKUP_PASSWORD or TAXTRACK_DB_PASSWORD is required." >&2
  exit 1
fi

if ! [[ "${SOURCE_PORT}" =~ ^[0-9]+$ ]] ||
  (( SOURCE_PORT < 1 || SOURCE_PORT > 65535 )); then
  echo "Backup port must be a valid TCP port, got '${SOURCE_PORT}'." >&2
  exit 1
fi

if [[ ! "${BACKUP_STAGE}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Backup stage contains unsupported characters: '${BACKUP_STAGE}'." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run the pinned PostgreSQL client and restore check." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but the Docker daemon is not available." >&2
  exit 1
fi

CONTAINER_SOURCE_HOST="${SOURCE_HOST}"
if [[ "${SOURCE_HOST}" == "127.0.0.1" || "${SOURCE_HOST}" == "localhost" ]]; then
  CONTAINER_SOURCE_HOST="host.docker.internal"
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_DIR="${BACKUP_ROOT}/${BACKUP_STAGE}/${TIMESTAMP}"
ARCHIVE_NAME="taxtrack-reference-data-${BACKUP_STAGE}-${TIMESTAMP}.dump"
ARCHIVE_PATH="${OUTPUT_DIR}/${ARCHIVE_NAME}"
VERIFY_CONTAINER="taxtrack-backup-verify-${TIMESTAMP}-$$"
VERIFY_PASSWORD="taxtrack-restore-check"

umask 077
mkdir -p "${OUTPUT_DIR}"
touch "${OUTPUT_DIR}/INCOMPLETE"
chmod 700 "${OUTPUT_DIR}"

cleanup() {
  if docker inspect "${VERIFY_CONTAINER}" >/dev/null 2>&1; then
    docker rm --force "${VERIFY_CONTAINER}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

source_psql() {
  docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    -e "PGPASSWORD=${SOURCE_PASSWORD}" \
    -e "PGSSLMODE=${SOURCE_SSLMODE}" \
    "${PG_IMAGE}" \
    psql \
    -X \
    -v ON_ERROR_STOP=1 \
    -h "${CONTAINER_SOURCE_HOST}" \
    -p "${SOURCE_PORT}" \
    -U "${SOURCE_USER}" \
    -d "${SOURCE_DATABASE}" \
    "$@"
}

write_source_counts() {
  local destination="$1"
  printf 'table_name\trow_count\n' >"${destination}"
  source_psql -At -F $'\t' -c \
    "select table_name, row_count
       from (
         select 'account'::text as table_name, count(*)::bigint as row_count from public.account
         union all
         select 'atc_codes', count(*) from public.atc_codes
         union all
         select 'entities', count(*) from public.entities
         union all
         select 'masterlist', count(*) from public.masterlist
         union all
         select 'user', count(*) from public.\"user\"
         union all
         select 'user_signature_profiles', count(*) from public.user_signature_profiles
       ) counts
      order by table_name;" >>"${destination}"
}

echo "Checking source tables through ${SOURCE_HOST}:${SOURCE_PORT}..."
TABLE_COUNT="$(
  source_psql -At -c \
    "select count(*)
       from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'user',
          'account',
          'user_signature_profiles',
          'entities',
          'masterlist',
          'atc_codes'
        );"
)"

if [[ "${TABLE_COUNT}" != "6" ]]; then
  echo "Expected 6 source tables but found ${TABLE_COUNT}. No backup was created." >&2
  exit 1
fi

write_source_counts "${OUTPUT_DIR}/row-counts-before.tsv"

SOURCE_METADATA="$(
  source_psql -At -F '|' -c \
    "select current_database(), current_user, current_setting('server_version');"
)"
IFS='|' read -r ACTUAL_DATABASE ACTUAL_USER SERVER_VERSION <<<"${SOURCE_METADATA}"

echo "Creating PostgreSQL custom archive..."
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e "PGPASSWORD=${SOURCE_PASSWORD}" \
  -e "PGSSLMODE=${SOURCE_SSLMODE}" \
  -v "${OUTPUT_DIR}:/backup" \
  "${PG_IMAGE}" \
  pg_dump \
  -h "${CONTAINER_SOURCE_HOST}" \
  -p "${SOURCE_PORT}" \
  -U "${SOURCE_USER}" \
  -d "${SOURCE_DATABASE}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --table='public."user"' \
  --table=public.account \
  --table=public.user_signature_profiles \
  --table=public.entities \
  --table=public.masterlist \
  --table=public.atc_codes \
  --file="/backup/${ARCHIVE_NAME}"

chmod 600 "${ARCHIVE_PATH}"

write_source_counts "${OUTPUT_DIR}/row-counts-after.tsv"
if ! cmp -s \
  "${OUTPUT_DIR}/row-counts-before.tsv" \
  "${OUTPUT_DIR}/row-counts-after.tsv"; then
  echo "Source row counts changed while the backup ran. Retry during a quiet window." >&2
  exit 1
fi

docker run --rm \
  -v "${OUTPUT_DIR}:/backup:ro" \
  "${PG_IMAGE}" \
  pg_restore --list "/backup/${ARCHIVE_NAME}" \
  >"${OUTPUT_DIR}/archive-list.txt"

if ! grep -q "TABLE DATA public user " "${OUTPUT_DIR}/archive-list.txt"; then
  echo "Archive validation failed: public.user data is missing." >&2
  exit 1
fi

echo "Restoring the archive into an isolated PostgreSQL container..."
docker run --detach \
  --name "${VERIFY_CONTAINER}" \
  -e "POSTGRES_PASSWORD=${VERIFY_PASSWORD}" \
  "${PG_IMAGE}" >/dev/null

READY=0
for _ in {1..30}; do
  if docker exec "${VERIFY_CONTAINER}" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [[ "${READY}" != "1" ]]; then
  echo "Restore verification database did not become ready." >&2
  exit 1
fi

docker exec -i "${VERIFY_CONTAINER}" \
  pg_restore \
  -U postgres \
  -d postgres \
  --no-owner \
  --no-privileges \
  <"${ARCHIVE_PATH}"

printf 'table_name\trow_count\n' >"${OUTPUT_DIR}/row-counts-restored.tsv"
docker exec "${VERIFY_CONTAINER}" \
  psql \
  -X \
  -v ON_ERROR_STOP=1 \
  -U postgres \
  -d postgres \
  -At \
  -F $'\t' \
  -c \
  "select table_name, row_count
     from (
       select 'account'::text as table_name, count(*)::bigint as row_count from public.account
       union all
       select 'atc_codes', count(*) from public.atc_codes
       union all
       select 'entities', count(*) from public.entities
       union all
       select 'masterlist', count(*) from public.masterlist
       union all
       select 'user', count(*) from public.\"user\"
       union all
       select 'user_signature_profiles', count(*) from public.user_signature_profiles
     ) counts
    order by table_name;" >>"${OUTPUT_DIR}/row-counts-restored.tsv"

if ! cmp -s \
  "${OUTPUT_DIR}/row-counts-before.tsv" \
  "${OUTPUT_DIR}/row-counts-restored.tsv"; then
  echo "Restore verification failed: restored row counts do not match the source." >&2
  exit 1
fi

cat >"${OUTPUT_DIR}/MANIFEST.txt" <<EOF
TaxTrack reference data backup

Created (UTC): ${TIMESTAMP}
Stage: ${BACKUP_STAGE}
Source host: ${SOURCE_HOST}
Source port: ${SOURCE_PORT}
Database: ${ACTUAL_DATABASE}
Database user: ${ACTUAL_USER}
PostgreSQL server: ${SERVER_VERSION}
Archive: ${ARCHIVE_NAME}
Archive format: PostgreSQL custom archive
Archive contents: schema and data

Included tables:
  public.user
  public.account
  public.user_signature_profiles
  public.entities
  public.masterlist
  public.atc_codes

Verification:
  Source counts were stable before and after pg_dump.
  The archive catalog contains public.user table data.
  The archive restored successfully into an isolated PostgreSQL container.
  Restored row counts exactly match source row counts.

Important:
  The account table contains password hashes. Keep this directory private.
  Sessions and verification tokens are intentionally excluded.
  Signature image objects in S3 are not included; only their database metadata is.
  Restore into an isolated database first. For a migrated target database, use
  pg_restore --data-only and resolve any existing-row conflicts deliberately.
EOF

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "${OUTPUT_DIR}"
    sha256sum \
      "${ARCHIVE_NAME}" \
      MANIFEST.txt \
      archive-list.txt \
      row-counts-before.tsv \
      row-counts-after.tsv \
      row-counts-restored.tsv \
      >SHA256SUMS
  )
else
  (
    cd "${OUTPUT_DIR}"
    shasum -a 256 \
      "${ARCHIVE_NAME}" \
      MANIFEST.txt \
      archive-list.txt \
      row-counts-before.tsv \
      row-counts-after.tsv \
      row-counts-restored.tsv \
      >SHA256SUMS
  )
fi

rm "${OUTPUT_DIR}/INCOMPLETE"
chmod 600 "${OUTPUT_DIR}"/*

echo
echo "Backup completed and restore-verified."
echo "Output: ${OUTPUT_DIR}"
echo "Archive: ${ARCHIVE_PATH}"
