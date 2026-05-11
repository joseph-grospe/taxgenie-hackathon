#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/webapp/tax-track"
OUTPUT_DIR="${APP_DIR}/.output"
CACHE_ROOT="${TAXTRACK_WEB_BUILD_CACHE_DIR:-${ROOT_DIR}/.taxtrack-build-cache/web}"
if [[ "${CACHE_ROOT}" != /* ]]; then
  CACHE_ROOT="${ROOT_DIR}/${CACHE_ROOT}"
fi
CACHE_VERSION="1"

HASH_PATHS=(
  "package.json"
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "tsconfig.base.json"
  "backend/shared/package.json"
  "backend/shared/tsconfig.json"
  "backend/shared/src"
  "webapp/tax-track/package.json"
  "webapp/tax-track/pnpm-lock.yaml"
  "webapp/tax-track/app.config.ts"
  "webapp/tax-track/vite.config.ts"
  "webapp/tax-track/tsconfig.json"
  "webapp/tax-track/components.json"
  "webapp/tax-track/public"
  "webapp/tax-track/src"
)

sha256() {
  if command -v shasum >/dev/null 2>&1; then
    LC_ALL=C LANG=C shasum -a 256 "$@"
  else
    sha256sum "$@"
  fi
}

hash_stream() {
  if command -v shasum >/dev/null 2>&1; then
    LC_ALL=C LANG=C shasum -a 256
  else
    sha256sum
  fi
}

list_hash_files() {
  if git -C "${ROOT_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "${ROOT_DIR}" ls-files --cached --others --exclude-standard -- "${HASH_PATHS[@]}"
    return
  fi

  for path in "${HASH_PATHS[@]}"; do
    if [[ -f "${ROOT_DIR}/${path}" ]]; then
      printf '%s\n' "${path}"
    elif [[ -d "${ROOT_DIR}/${path}" ]]; then
      find "${ROOT_DIR}/${path}" -type f | sed "s#^${ROOT_DIR}/##"
    fi
  done
}

list_import_meta_env_keys() {
  { grep -RhoE 'import\.meta\.env\.[A-Z0-9_]+' "${APP_DIR}/src" 2>/dev/null || true; } \
    | sed 's/^import\.meta\.env\.//' \
    | sort -u
}

compute_build_hash() {
  {
    printf 'cache-version %s\n' "${CACHE_VERSION}"
    printf 'node %s\n' "$(node --version 2>/dev/null || true)"
    printf 'pnpm %s\n' "$(pnpm --version 2>/dev/null || true)"

    list_hash_files | sort -u | while IFS= read -r file; do
      [[ -n "${file}" && -f "${ROOT_DIR}/${file}" ]] || continue
      printf 'file %s\n' "${file}"
      sha256 "${ROOT_DIR}/${file}" | awk '{print $1}'
    done

    list_import_meta_env_keys | while IFS= read -r key; do
      case "${key}" in
        BASE_URL|DEV|MODE|PROD|SSR)
          continue
          ;;
      esac

      [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
      printf 'import-meta-env %s=%s\n' "${key}" "${!key-}"
    done

    if [[ -n "${TAXTRACK_WEB_BUILD_CACHE_ENV_KEYS:-}" ]]; then
      IFS=',' read -ra extra_env_keys <<<"${TAXTRACK_WEB_BUILD_CACHE_ENV_KEYS}"
      for raw_key in "${extra_env_keys[@]}"; do
        key="$(printf '%s' "${raw_key}" | xargs)"
        [[ -n "${key}" ]] || continue
        [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        printf 'extra-env %s=%s\n' "${key}" "${!key-}"
      done
    fi
  } | hash_stream | awk '{print $1}'
}

restore_cached_output() {
  local cache_dir="$1"

  rm -rf "${OUTPUT_DIR}"
  (
    cd "${cache_dir}"
    LC_ALL=C LANG=C tar -cf - .output
  ) | (
    cd "${APP_DIR}"
    LC_ALL=C LANG=C tar -xf -
  )
}

store_cached_output() {
  local cache_dir="$1"
  local temp_dir="${cache_dir}.tmp.$$"

  rm -rf "${temp_dir}"
  mkdir -p "${temp_dir}"
  (
    cd "${APP_DIR}"
    LC_ALL=C LANG=C tar -cf - .output
  ) | (
    cd "${temp_dir}"
    LC_ALL=C LANG=C tar -xf -
  )

  rm -rf "${cache_dir}"
  mv "${temp_dir}" "${cache_dir}"
}

run_build() {
  case " ${NODE_OPTIONS:-} " in
    *" --max-old-space-size="*) ;;
    *) export NODE_OPTIONS="${NODE_OPTIONS:+${NODE_OPTIONS} }--max-old-space-size=4096" ;;
  esac

  (
    cd "${APP_DIR}"
    pnpm build
  )
}

build_hash="$(compute_build_hash)"
cache_dir="${CACHE_ROOT}/${build_hash}"

mkdir -p "${CACHE_ROOT}"

if [[ "${TAXTRACK_WEB_BUILD_FORCE:-}" != "1" && -f "${cache_dir}/.output/nitro.json" ]]; then
  echo "TaxTrack web build cache hit: ${build_hash}"
  restore_cached_output "${cache_dir}"
  exit 0
fi

echo "TaxTrack web build cache miss: ${build_hash}"
run_build

if [[ ! -f "${OUTPUT_DIR}/nitro.json" ]]; then
  echo "Expected frontend build output at ${OUTPUT_DIR}/nitro.json" >&2
  exit 1
fi

store_cached_output "${cache_dir}"
echo "TaxTrack web build cached: ${build_hash}"
