#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/test-merge-worker-local.sh <merge-job-id>
  MERGE_JOB_ID=<merge-job-id> ./scripts/test-merge-worker-local.sh
  ./scripts/test-merge-worker-local.sh --list

Run the TaxTrack PDF merge worker locally against an existing merge job.

Options:
  --env <file>       Env file to load. Defaults to TAXTRACK_ENV_FILE or .env.local.
  --docker           Build and run the merge worker Docker image.
                     If qpdf is missing, Docker is used automatically when available.
  --list             List recent merge jobs from DATABASE_URL and exit.
  --skip-db-check    Skip local manifest validation before running.
  -h, --help         Show this help.

Environment:
  Required for run: DATABASE_URL, S3_BUCKET_NAME, MERGE_JOB_ID
  Optional: AWS_REGION, AWS_PROFILE, ALLOW_RERUN=1, SKIP_DB_CHECK=1

Examples:
  TAXTRACK_ENV_FILE=.env.local ./scripts/test-merge-worker-local.sh 00000000-0000-0000-0000-000000000000
  pnpm test:merge-worker -- 00000000-0000-0000-0000-000000000000
  ./scripts/test-merge-worker-local.sh --list
  ./scripts/test-merge-worker-local.sh --docker 00000000-0000-0000-0000-000000000000
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE_INPUT="${TAXTRACK_ENV_FILE:-.env.local}"
JOB_ID_ARG=""
RUN_IN_DOCKER=0
LIST_ONLY=0
SKIP_DB_CHECK="${SKIP_DB_CHECK:-0}"

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --env)
      if [[ -z "${2:-}" ]]; then
        echo "--env requires a file path." >&2
        exit 1
      fi
      ENV_FILE_INPUT="$2"
      shift 2
      ;;
    --docker)
      RUN_IN_DOCKER=1
      shift
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
    --skip-db-check)
      SKIP_DB_CHECK=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -n "${JOB_ID_ARG}" ]]; then
        echo "Only one merge job id may be provided." >&2
        usage
        exit 1
      fi
      JOB_ID_ARG="$1"
      shift
      ;;
  esac
done

if [[ "${ENV_FILE_INPUT}" = /* ]]; then
  ENV_FILE="${ENV_FILE_INPUT}"
else
  ENV_FILE="${ROOT_DIR}/${ENV_FILE_INPUT}"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Could not find env file at ${ENV_FILE}" >&2
  echo "Set TAXTRACK_ENV_FILE or pass --env <file>." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

export TAXTRACK_ENV_FILE="${ENV_FILE}"
export AWS_REGION="${AWS_REGION:-ap-southeast-1}"

MERGE_JOB_ID="${JOB_ID_ARG:-${MERGE_JOB_ID:-}}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "${name} is required. Add it to ${ENV_FILE} or export it before running." >&2
    exit 1
  fi
}

require_psql() {
  if ! command -v psql >/dev/null 2>&1; then
    echo "psql is required for this operation." >&2
    echo "Install libpq/Postgres client tools, or rerun with --skip-db-check for worker execution." >&2
    exit 1
  fi
}

list_recent_jobs() {
  require_env "DATABASE_URL"
  require_psql

  psql "${DATABASE_URL}" <<'SQL'
select
  id,
  status,
  payee_short_name,
  period_type,
  year,
  quarter,
  total_input_files,
  output_count,
  created_at
from certificate_merge_jobs
order by created_at desc
limit 15;
SQL
}

scalar_query() {
  local sql="$1"
  psql "${DATABASE_URL}" \
    -v ON_ERROR_STOP=1 \
    -v job_id="${MERGE_JOB_ID}" \
    -tA \
    -c "${sql}" \
    | tr -d '[:space:]'
}

validate_job_manifest() {
  if [[ "${SKIP_DB_CHECK}" == "1" ]]; then
    echo "Skipping DB manifest check because SKIP_DB_CHECK=1."
    return
  fi

  if ! command -v psql >/dev/null 2>&1; then
    echo "psql was not found; skipping DB manifest check."
    echo "Install libpq/Postgres client tools for local validation."
    return
  fi

  local job_status
  local input_count
  local output_count
  local missing_key_count

  job_status="$(scalar_query "select coalesce((select status from certificate_merge_jobs where id = :'job_id'::uuid), '');")"
  if [[ -z "${job_status}" ]]; then
    echo "Merge job ${MERGE_JOB_ID} was not found in DATABASE_URL." >&2
    exit 1
  fi

  input_count="$(scalar_query "select count(*) from certificate_merge_job_inputs where merge_job_id = :'job_id'::uuid;")"
  output_count="$(scalar_query "select count(*) from certificate_merge_job_outputs where merge_job_id = :'job_id'::uuid;")"
  missing_key_count="$(scalar_query "select count(*) from certificate_merge_job_inputs where merge_job_id = :'job_id'::uuid and coalesce(trim(signed_pdf_key), '') = '';")"

  echo "Merge job manifest:"
  psql "${DATABASE_URL}" -v job_id="${MERGE_JOB_ID}" <<'SQL'
select
  id,
  status,
  payee_short_name,
  period_type,
  year,
  quarter,
  total_input_files,
  output_count,
  error_message
from certificate_merge_jobs
where id = :'job_id'::uuid;

select
  count(*) as input_rows,
  coalesce(sum(size_bytes), 0) as total_input_size_bytes,
  count(*) filter (where coalesce(trim(signed_pdf_key), '') = '') as missing_signed_pdf_keys
from certificate_merge_job_inputs
where merge_job_id = :'job_id'::uuid;

select
  part_number,
  status,
  input_count,
  size_bytes,
  output_key
from certificate_merge_job_outputs
where merge_job_id = :'job_id'::uuid
order by part_number;
SQL

  if [[ "${input_count}" == "0" || "${output_count}" == "0" ]]; then
    echo "Merge job ${MERGE_JOB_ID} has an empty manifest." >&2
    echo "Create the merge job from the app before running the worker." >&2
    exit 1
  fi

  if [[ "${missing_key_count}" != "0" ]]; then
    echo "Merge job ${MERGE_JOB_ID} has input rows without signed_pdf_key." >&2
    exit 1
  fi

  if [[ "${job_status}" == "succeeded" && "${ALLOW_RERUN:-0}" != "1" ]]; then
    echo "Merge job ${MERGE_JOB_ID} already succeeded." >&2
    echo "Set ALLOW_RERUN=1 if you intentionally want to rerun and overwrite outputs." >&2
    exit 1
  fi

  if [[ "${job_status}" == "running" && "${ALLOW_RERUN:-0}" != "1" ]]; then
    echo "Merge job ${MERGE_JOB_ID} is already marked running." >&2
    echo "Set ALLOW_RERUN=1 if this is a stale local test job." >&2
    exit 1
  fi
}

run_on_host() {
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm is required to run the merge worker locally." >&2
    exit 1
  fi

  if ! command -v qpdf >/dev/null 2>&1; then
    echo "qpdf is required for host mode." >&2
    echo "Install it with: brew install qpdf" >&2
    echo "Or rerun with --docker." >&2
    exit 1
  fi

  echo "Running merge worker on host for MERGE_JOB_ID=${MERGE_JOB_ID}"
  cd "${ROOT_DIR}"
  MERGE_JOB_ID="${MERGE_JOB_ID}" TAXTRACK_ENV_FILE="${ENV_FILE}" pnpm dev:merge-worker
}

run_in_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required for --docker mode." >&2
    exit 1
  fi

  local image="${TAXTRACK_MERGE_WORKER_LOCAL_IMAGE:-taxtrack-merge-worker:local}"
  local docker_database_url="${DATABASE_URL}"
  local aws_mount_args=()

  docker_database_url="${docker_database_url//localhost/host.docker.internal}"
  docker_database_url="${docker_database_url//127.0.0.1/host.docker.internal}"

  if [[ -d "${HOME}/.aws" ]]; then
    aws_mount_args=(-v "${HOME}/.aws:/root/.aws:ro")
  fi

  echo "Building merge worker image ${image}"
  docker build -f "${ROOT_DIR}/backend/merge-worker/Dockerfile" -t "${image}" "${ROOT_DIR}"

  echo "Running merge worker container for MERGE_JOB_ID=${MERGE_JOB_ID}"
  docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    --env-file "${ENV_FILE}" \
    -e "MERGE_JOB_ID=${MERGE_JOB_ID}" \
    -e "DATABASE_URL=${docker_database_url}" \
    -e "AWS_REGION=${AWS_REGION}" \
    "${aws_mount_args[@]}" \
    "${image}"
}

if [[ "${LIST_ONLY}" == "1" ]]; then
  list_recent_jobs
  exit 0
fi

if [[ -z "${MERGE_JOB_ID}" ]]; then
  echo "MERGE_JOB_ID is required." >&2
  echo "Run ./scripts/test-merge-worker-local.sh --list to see recent jobs." >&2
  usage
  exit 1
fi

require_env "DATABASE_URL"
require_env "S3_BUCKET_NAME"

validate_job_manifest

if [[ "${RUN_IN_DOCKER}" == "1" ]]; then
  run_in_docker
elif command -v qpdf >/dev/null 2>&1; then
  run_on_host
elif command -v docker >/dev/null 2>&1; then
  echo "qpdf was not found; falling back to Docker mode."
  run_in_docker
else
  echo "qpdf is required for host mode." >&2
  echo "Install it with: brew install qpdf" >&2
  echo "Or install Docker and rerun this command." >&2
  exit 1
fi
