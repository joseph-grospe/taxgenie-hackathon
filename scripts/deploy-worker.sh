#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-worker.sh [tag]

Build, push, and deploy the TaxTrack worker image for the current SST stage.

Arguments:
  tag     Optional Docker tag. Defaults to <git-sha>[-dirty]-<timestamp>.

Environment:
  - Reads variables from .env at repository root
  - Optional: TAXTRACK_ENV_FILE to point to a different env file
  - Required: SST_STAGE, AWS_REGION
  - Required: WORKER_ECR_REPOSITORY or a valid TAXTRACK_WORKER_IMAGE_URI
  - Writes the generated TAXTRACK_WORKER_IMAGE_URI back to the env file

Examples:
  ./scripts/deploy-worker.sh
  ./scripts/deploy-worker.sh manual-20260414
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${TAXTRACK_ENV_FILE:-${ROOT_DIR}/.env}"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

TAG_INPUT="${1:-}"

if [[ "${TAG_INPUT}" == "--help" || "${TAG_INPUT}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "$#" -gt 1 ]]; then
  usage
  exit 1
fi

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

export AWS_REGION="${AWS_REGION:-ap-southeast-1}"

resolve_repository() {
  if [[ -n "${WORKER_ECR_REPOSITORY:-}" ]]; then
    printf '%s\n' "${WORKER_ECR_REPOSITORY}"
    return 0
  fi

  if [[ -n "${TAXTRACK_WORKER_IMAGE_URI:-}" && "${TAXTRACK_WORKER_IMAGE_URI}" != "replace-me" ]]; then
    printf '%s\n' "${TAXTRACK_WORKER_IMAGE_URI}" | sed -E 's/@sha256:[[:xdigit:]]+$//; s/:[^/:@]+$//'
    return 0
  fi

  return 1
}

persist_env_value() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local tmp_file

  tmp_file="$(mktemp "${env_file}.XXXXXX")"

  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$env_file" >"$tmp_file"

  mv "$tmp_file" "$env_file"
}

if ! ECR_REPOSITORY="$(resolve_repository)"; then
  echo "Set WORKER_ECR_REPOSITORY in ${ENV_FILE} or provide a valid TAXTRACK_WORKER_IMAGE_URI." >&2
  exit 1
fi

if [[ "${ECR_REPOSITORY}" != *"/"* ]]; then
  echo "Invalid ECR repository: ${ECR_REPOSITORY}" >&2
  exit 1
fi

if [[ -n "${TAG_INPUT}" ]]; then
  IMAGE_TAG="${TAG_INPUT}"
else
  GIT_SHA="$(git -C "${ROOT_DIR}" rev-parse --short=12 HEAD 2>/dev/null || echo "manual")"
  TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
  DIRTY_SUFFIX=""

  if ! git -C "${ROOT_DIR}" diff --quiet --ignore-submodules HEAD -- 2>/dev/null; then
    DIRTY_SUFFIX="-dirty"
  fi

  IMAGE_TAG="${GIT_SHA}${DIRTY_SUFFIX}-${TIMESTAMP}"
fi

IMAGE_URI="${ECR_REPOSITORY}:${IMAGE_TAG}"
REGISTRY="${ECR_REPOSITORY%/*}"

echo "Publishing worker image='${IMAGE_URI}' stage='${SST_STAGE}' region='${AWS_REGION}'"

aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

if ! docker buildx inspect >/dev/null 2>&1; then
  docker buildx create --use >/dev/null
fi
docker buildx inspect --bootstrap >/dev/null

# The worker EC2 host is x86_64, so local builds must target linux/amd64.
docker buildx build \
  --platform linux/amd64 \
  -f backend/worker/Dockerfile \
  -t "${IMAGE_URI}" \
  --push \
  "${ROOT_DIR}"

persist_env_value "${ENV_FILE}" "TAXTRACK_WORKER_IMAGE_URI" "${IMAGE_URI}"
echo "Updated ${ENV_FILE} with TAXTRACK_WORKER_IMAGE_URI='${IMAGE_URI}'"

echo "Deploying worker image to SST stage='${SST_STAGE}'"

export TAXTRACK_INFRA_SCOPE="all"
export TAXTRACK_WORKER_IMAGE_URI="${IMAGE_URI}"

pnpm --filter @taxtrack/infra exec sst install
SST_STAGE="${SST_STAGE}" pnpm --filter @taxtrack/infra exec sst deploy --stage "${SST_STAGE}"

echo "Worker deploy complete: ${IMAGE_URI}"
