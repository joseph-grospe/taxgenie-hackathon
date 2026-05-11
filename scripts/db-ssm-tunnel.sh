#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  TAXTRACK_ENV_FILE=.env.uat pnpm db:tunnel

Starts an AWS SSM port-forwarding session to private RDS through an
SSM-enabled EC2 instance, normally the TaxTrack worker EC2.

Required environment:
  AWS_REGION
  TAXTRACK_DB_TUNNEL_INSTANCE_ID   EC2 instance ID, usually SST workerInstanceId
  TAXTRACK_DB_TUNNEL_HOST          RDS hostname, usually SST dbHost
                                  Optional when DATABASE_URL contains a host

Optional environment:
  TAXTRACK_ENV_FILE                Defaults to .env at repository root
  TAXTRACK_DB_TUNNEL_LOCAL_PORT    Defaults to 15432
  TAXTRACK_DB_TUNNEL_REMOTE_PORT   Defaults to DATABASE_URL port or 5432
  TAXTRACK_DB_TUNNEL_DATABASE      pgAdmin database name hint
  TAXTRACK_DB_TUNNEL_USER          pgAdmin username hint

pgAdmin should connect to:
  Host: localhost
  Port: TAXTRACK_DB_TUNNEL_LOCAL_PORT
  SSL mode: Require
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE_INPUT="${TAXTRACK_ENV_FILE:-${ROOT_DIR}/.env}"

ORIGINAL_AWS_REGION_SET="${AWS_REGION+x}"
ORIGINAL_AWS_REGION="${AWS_REGION-}"
ORIGINAL_AWS_PROFILE_SET="${AWS_PROFILE+x}"
ORIGINAL_AWS_PROFILE="${AWS_PROFILE-}"
ORIGINAL_AWS_ACCESS_KEY_ID_SET="${AWS_ACCESS_KEY_ID+x}"
ORIGINAL_AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID-}"
ORIGINAL_AWS_SECRET_ACCESS_KEY_SET="${AWS_SECRET_ACCESS_KEY+x}"
ORIGINAL_AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY-}"
ORIGINAL_AWS_SESSION_TOKEN_SET="${AWS_SESSION_TOKEN+x}"
ORIGINAL_AWS_SESSION_TOKEN="${AWS_SESSION_TOKEN-}"
ORIGINAL_DATABASE_URL_SET="${DATABASE_URL+x}"
ORIGINAL_DATABASE_URL="${DATABASE_URL-}"
ORIGINAL_TUNNEL_INSTANCE_ID_SET="${TAXTRACK_DB_TUNNEL_INSTANCE_ID+x}"
ORIGINAL_TUNNEL_INSTANCE_ID="${TAXTRACK_DB_TUNNEL_INSTANCE_ID-}"
ORIGINAL_TUNNEL_HOST_SET="${TAXTRACK_DB_TUNNEL_HOST+x}"
ORIGINAL_TUNNEL_HOST="${TAXTRACK_DB_TUNNEL_HOST-}"
ORIGINAL_TUNNEL_LOCAL_PORT_SET="${TAXTRACK_DB_TUNNEL_LOCAL_PORT+x}"
ORIGINAL_TUNNEL_LOCAL_PORT="${TAXTRACK_DB_TUNNEL_LOCAL_PORT-}"
ORIGINAL_TUNNEL_REMOTE_PORT_SET="${TAXTRACK_DB_TUNNEL_REMOTE_PORT+x}"
ORIGINAL_TUNNEL_REMOTE_PORT="${TAXTRACK_DB_TUNNEL_REMOTE_PORT-}"
ORIGINAL_TUNNEL_DATABASE_SET="${TAXTRACK_DB_TUNNEL_DATABASE+x}"
ORIGINAL_TUNNEL_DATABASE="${TAXTRACK_DB_TUNNEL_DATABASE-}"
ORIGINAL_TUNNEL_USER_SET="${TAXTRACK_DB_TUNNEL_USER+x}"
ORIGINAL_TUNNEL_USER="${TAXTRACK_DB_TUNNEL_USER-}"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "$#" -gt 0 ]]; then
  usage >&2
  exit 1
fi

if [[ "${ENV_FILE_INPUT}" = /* ]]; then
  ENV_FILE="${ENV_FILE_INPUT}"
else
  ENV_FILE="${ROOT_DIR}/${ENV_FILE_INPUT}"
fi

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
elif [[ -n "${TAXTRACK_ENV_FILE:-}" ]]; then
  echo "Could not find env file at ${ENV_FILE}" >&2
  exit 1
fi

restore_original_env() {
  local name="$1"
  local was_set="$2"
  local value="$3"

  if [[ -n "${was_set}" ]] && ! is_placeholder_value "${value}"; then
    export "${name}=${value}"
  fi
}

is_placeholder_value() {
  local normalized
  normalized="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "${normalized}" == "replace-me" || "${normalized}" == "replace_me" ]]
}

clear_placeholder_env() {
  local name="$1"

  if [[ -n "${!name:-}" ]] && is_placeholder_value "${!name}"; then
    unset "${name}"
  fi
}

restore_original_env "AWS_REGION" "${ORIGINAL_AWS_REGION_SET}" "${ORIGINAL_AWS_REGION}"
restore_original_env "AWS_PROFILE" "${ORIGINAL_AWS_PROFILE_SET}" "${ORIGINAL_AWS_PROFILE}"
restore_original_env "AWS_ACCESS_KEY_ID" "${ORIGINAL_AWS_ACCESS_KEY_ID_SET}" "${ORIGINAL_AWS_ACCESS_KEY_ID}"
restore_original_env "AWS_SECRET_ACCESS_KEY" "${ORIGINAL_AWS_SECRET_ACCESS_KEY_SET}" "${ORIGINAL_AWS_SECRET_ACCESS_KEY}"
restore_original_env "AWS_SESSION_TOKEN" "${ORIGINAL_AWS_SESSION_TOKEN_SET}" "${ORIGINAL_AWS_SESSION_TOKEN}"
restore_original_env "DATABASE_URL" "${ORIGINAL_DATABASE_URL_SET}" "${ORIGINAL_DATABASE_URL}"
restore_original_env "TAXTRACK_DB_TUNNEL_INSTANCE_ID" "${ORIGINAL_TUNNEL_INSTANCE_ID_SET}" "${ORIGINAL_TUNNEL_INSTANCE_ID}"
restore_original_env "TAXTRACK_DB_TUNNEL_HOST" "${ORIGINAL_TUNNEL_HOST_SET}" "${ORIGINAL_TUNNEL_HOST}"
restore_original_env "TAXTRACK_DB_TUNNEL_LOCAL_PORT" "${ORIGINAL_TUNNEL_LOCAL_PORT_SET}" "${ORIGINAL_TUNNEL_LOCAL_PORT}"
restore_original_env "TAXTRACK_DB_TUNNEL_REMOTE_PORT" "${ORIGINAL_TUNNEL_REMOTE_PORT_SET}" "${ORIGINAL_TUNNEL_REMOTE_PORT}"
restore_original_env "TAXTRACK_DB_TUNNEL_DATABASE" "${ORIGINAL_TUNNEL_DATABASE_SET}" "${ORIGINAL_TUNNEL_DATABASE}"
restore_original_env "TAXTRACK_DB_TUNNEL_USER" "${ORIGINAL_TUNNEL_USER_SET}" "${ORIGINAL_TUNNEL_USER}"

for env_name in \
  AWS_REGION \
  AWS_PROFILE \
  AWS_ACCESS_KEY_ID \
  AWS_SECRET_ACCESS_KEY \
  AWS_SESSION_TOKEN \
  DATABASE_URL \
  TAXTRACK_DB_TUNNEL_INSTANCE_ID \
  TAXTRACK_DB_TUNNEL_HOST \
  TAXTRACK_DB_TUNNEL_LOCAL_PORT \
  TAXTRACK_DB_TUNNEL_REMOTE_PORT \
  TAXTRACK_DB_TUNNEL_DATABASE \
  TAXTRACK_DB_TUNNEL_USER; do
  clear_placeholder_env "${env_name}"
done

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "${name} is required." >&2
    usage >&2
    exit 1
  fi
}

parse_database_url() {
  local field="$1"

  [[ -n "${DATABASE_URL:-}" ]] || return 1
  command -v node >/dev/null 2>&1 || return 1

  DATABASE_URL="${DATABASE_URL}" node -e '
    const field = process.argv[1];
    try {
      const url = new URL(process.env.DATABASE_URL);
      const decode = (value) => decodeURIComponent(value || "");
      const values = {
        host: url.hostname,
        port: url.port,
        database: decode(url.pathname.replace(/^\//u, "")),
        user: decode(url.username),
      };
      process.stdout.write(values[field] || "");
    } catch {
      process.exit(2);
    }
  ' "${field}"
}

require_port() {
  local name="$1"
  local value="$2"

  if ! [[ "${value}" =~ ^[0-9]+$ ]] ||
    (( value < 1 || value > 65535 )); then
    echo "${name} must be a valid TCP port, got '${value}'." >&2
    exit 1
  fi
}

require_env "AWS_REGION"
require_env "TAXTRACK_DB_TUNNEL_INSTANCE_ID"

TUNNEL_HOST="${TAXTRACK_DB_TUNNEL_HOST:-}"
if [[ -z "${TUNNEL_HOST}" ]]; then
  TUNNEL_HOST="$(parse_database_url host || true)"
fi

if [[ -z "${TUNNEL_HOST}" ]]; then
  echo "TAXTRACK_DB_TUNNEL_HOST is required when DATABASE_URL is not set or cannot be parsed." >&2
  usage >&2
  exit 1
fi

if [[ "${TUNNEL_HOST}" == *\"* || "${TUNNEL_HOST}" == *\\* || "${TUNNEL_HOST}" =~ [[:space:]] ]]; then
  echo "TAXTRACK_DB_TUNNEL_HOST contains unsupported characters." >&2
  exit 1
fi

LOCAL_PORT="${TAXTRACK_DB_TUNNEL_LOCAL_PORT:-15432}"
REMOTE_PORT="${TAXTRACK_DB_TUNNEL_REMOTE_PORT:-}"
if [[ -z "${REMOTE_PORT}" ]]; then
  REMOTE_PORT="$(parse_database_url port || true)"
fi
REMOTE_PORT="${REMOTE_PORT:-5432}"

require_port "TAXTRACK_DB_TUNNEL_LOCAL_PORT" "${LOCAL_PORT}"
require_port "TAXTRACK_DB_TUNNEL_REMOTE_PORT" "${REMOTE_PORT}"

DB_NAME="${TAXTRACK_DB_TUNNEL_DATABASE:-}"
DB_USER="${TAXTRACK_DB_TUNNEL_USER:-}"
if [[ -z "${DB_NAME}" ]]; then
  DB_NAME="$(parse_database_url database || true)"
fi
if [[ -z "${DB_USER}" ]]; then
  DB_USER="$(parse_database_url user || true)"
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required." >&2
  exit 1
fi

cat <<EOF
Starting TaxTrack private RDS tunnel through SSM.

SSM target instance: ${TAXTRACK_DB_TUNNEL_INSTANCE_ID}
Remote database:     ${TUNNEL_HOST}:${REMOTE_PORT}
Local endpoint:      localhost:${LOCAL_PORT}

pgAdmin settings:
  Host:      localhost
  Port:      ${LOCAL_PORT}
  Database:  ${DB_NAME:-use database name from SST databaseUrl output}
  Username:  ${DB_USER:-use username from SST databaseUrl output}
  Password:  use password from SST databaseUrl output or TAXTRACK_DB_PASSWORD
  SSL mode:  Require

Leave this session running while pgAdmin is connected.
EOF

PARAMETERS="$(printf '{"host":["%s"],"portNumber":["%s"],"localPortNumber":["%s"]}' \
  "${TUNNEL_HOST}" \
  "${REMOTE_PORT}" \
  "${LOCAL_PORT}")"

exec aws ssm start-session \
  --target "${TAXTRACK_DB_TUNNEL_INSTANCE_ID}" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "${PARAMETERS}" \
  --region "${AWS_REGION}"
