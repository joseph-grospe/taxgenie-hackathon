#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-taxtrack.sh [scope]

scope:
  all (default), backend, web, app

Environment:
  - Reads variables from .env at repository root
  - Initialize from .env.sample once: cp .env.sample .env
  - Optional: TAXTRACK_ENV_FILE to point to a different env file
  - Optional: Additional SST flags can be passed after --scope via positional args

Example:
  ./scripts/deploy-taxtrack.sh web
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${TAXTRACK_ENV_FILE:-${ROOT_DIR}/.env}"

SCOPE="${1:-all}"
if [[ "$SCOPE" == "--help" || "$SCOPE" == "-h" ]]; then
  usage
  exit 0
fi

case "$SCOPE" in
  all|backend|web|app)
    shift || true
    ;;
  *)
    echo "Invalid scope: ${SCOPE}" >&2
    usage
    exit 1
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Could not find env file at ${ENV_FILE}" >&2
  echo "Create one from .env.sample: cp .env.sample .env" >&2
  echo "Or set TAXTRACK_ENV_FILE to an existing file." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${SST_STAGE:-}" ]]; then
  echo "SST_STAGE is required in ${ENV_FILE}." >&2
  exit 1
fi

DEPLOY_STAGE="$SST_STAGE"
if [[ "$SCOPE" != "all" && ! "$DEPLOY_STAGE" == *"-${SCOPE}" ]]; then
  echo "Auto-adjusting SST_STAGE for ${SCOPE} scope: ${DEPLOY_STAGE} -> ${DEPLOY_STAGE}-${SCOPE}"
  DEPLOY_STAGE="${DEPLOY_STAGE}-${SCOPE}"
fi

export TAXTRACK_INFRA_SCOPE="$SCOPE"

echo "Deploying taxtrack scope='${TAXTRACK_INFRA_SCOPE}' stage='${DEPLOY_STAGE}'"
SST_STAGE="$DEPLOY_STAGE" pnpm --filter @taxtrack/infra exec sst deploy --stage "$DEPLOY_STAGE" "$@"
