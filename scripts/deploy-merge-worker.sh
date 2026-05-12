#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-merge-worker.sh [tag]

Build, push, and deploy the TaxTrack PDF merge worker image for the current SST stage.

Arguments:
  tag     Optional Docker tag. Defaults to <git-sha>[-dirty]-<timestamp>.

Environment:
  - Reads variables from .env at repository root
  - Optional: TAXTRACK_ENV_FILE to point to a different env file
  - Required: SST_STAGE, AWS_REGION
  - Required: MERGE_WORKER_ECR_REPOSITORY or a valid TAXTRACK_MERGE_WORKER_IMAGE_URI
  - Writes the generated TAXTRACK_MERGE_WORKER_IMAGE_URI back to the env file
  - Set TAXTRACK_MERGE_WORKER_IMAGE_FORCE=1 to rebuild even when merge worker source is unchanged
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${TAXTRACK_ENV_FILE:-${ROOT_DIR}/.env}"

# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/worker-image-cache.sh"

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
  if [[ -n "${MERGE_WORKER_ECR_REPOSITORY:-}" ]]; then
    printf '%s\n' "${MERGE_WORKER_ECR_REPOSITORY}"
    return 0
  fi

  if [[ -n "${TAXTRACK_MERGE_WORKER_IMAGE_URI:-}" && "${TAXTRACK_MERGE_WORKER_IMAGE_URI}" != "replace-me" ]]; then
    printf '%s\n' "${TAXTRACK_MERGE_WORKER_IMAGE_URI}" | sed -E 's/@sha256:[[:xdigit:]]+$//; s/:[^/:@]+$//'
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
  echo "Set MERGE_WORKER_ECR_REPOSITORY in ${ENV_FILE} or provide a valid TAXTRACK_MERGE_WORKER_IMAGE_URI." >&2
  exit 1
fi

if [[ "${ECR_REPOSITORY}" != *"/"* ]]; then
  echo "Invalid ECR repository: ${ECR_REPOSITORY}" >&2
  exit 1
fi

MERGE_WORKER_HASH_PATHS=(
  ".dockerignore"
  "package.json"
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "tsconfig.base.json"
  "backend/shared"
  "backend/merge-worker"
)
IMAGE_SOURCE_HASH="$(
  taxtrack_compute_image_source_hash "${ROOT_DIR}" "merge-worker" "${MERGE_WORKER_HASH_PATHS[@]}"
)"
SKIP_IMAGE_BUILD=0

if [[ -z "${TAG_INPUT}" && "${TAXTRACK_MERGE_WORKER_IMAGE_FORCE:-}" != "1" ]]; then
  CACHED_IMAGE_URI="${TAXTRACK_MERGE_WORKER_IMAGE_URI:-}"
  CACHED_IMAGE_SOURCE_HASH="${TAXTRACK_MERGE_WORKER_IMAGE_SOURCE_HASH:-}"

  if [[ -n "${CACHED_IMAGE_URI}" &&
    "${CACHED_IMAGE_URI}" != "replace-me" &&
    "${CACHED_IMAGE_SOURCE_HASH}" == "${IMAGE_SOURCE_HASH}" ]]; then
    if CACHED_REPOSITORY="$(taxtrack_image_repository_from_uri "${CACHED_IMAGE_URI}")" &&
      [[ "${CACHED_REPOSITORY}" == "${ECR_REPOSITORY}" ]]; then
      if taxtrack_ecr_image_exists "${CACHED_IMAGE_URI}" "${AWS_REGION}"; then
        IMAGE_URI="${CACHED_IMAGE_URI}"
        SKIP_IMAGE_BUILD=1
        echo "Merge worker image cache hit: ${IMAGE_SOURCE_HASH}"
      else
        echo "Merge worker image cache entry missing in ECR; rebuilding."
      fi
    else
      echo "Merge worker image cache repository differs from ${ECR_REPOSITORY}; rebuilding."
    fi
  fi
fi

if [[ "${SKIP_IMAGE_BUILD}" != "1" ]]; then
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

  echo "Publishing merge worker image='${IMAGE_URI}' stage='${SST_STAGE}' region='${AWS_REGION}'"

  aws ecr get-login-password --region "${AWS_REGION}" \
    | docker login --username AWS --password-stdin "${REGISTRY}"

  if ! docker buildx inspect >/dev/null 2>&1; then
    docker buildx create --use >/dev/null
  fi
  docker buildx inspect --bootstrap >/dev/null

  docker buildx build \
    --platform linux/amd64 \
    --provenance=false \
    --sbom=false \
    -f backend/merge-worker/Dockerfile \
    -t "${IMAGE_URI}" \
    --push \
    "${ROOT_DIR}"

  persist_env_value "${ENV_FILE}" "TAXTRACK_MERGE_WORKER_IMAGE_URI" "${IMAGE_URI}"
  persist_env_value "${ENV_FILE}" "TAXTRACK_MERGE_WORKER_IMAGE_SOURCE_HASH" "${IMAGE_SOURCE_HASH}"
  echo "Updated ${ENV_FILE} with TAXTRACK_MERGE_WORKER_IMAGE_URI='${IMAGE_URI}'"
  echo "Updated ${ENV_FILE} with TAXTRACK_MERGE_WORKER_IMAGE_SOURCE_HASH='${IMAGE_SOURCE_HASH}'"
else
  echo "Reusing merge worker image='${IMAGE_URI}'"
fi

echo "Deploying merge worker Batch resources to SST stage='${SST_STAGE}'"

export TAXTRACK_INFRA_SCOPE="all"
export TAXTRACK_MERGE_WORKER_IMAGE_URI="${IMAGE_URI}"

pnpm --filter @taxtrack/infra exec sst install
SST_STAGE="${SST_STAGE}" pnpm --filter @taxtrack/infra exec sst deploy --stage "${SST_STAGE}"

echo "Merge worker deploy complete: ${IMAGE_URI}"
