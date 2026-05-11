#!/usr/bin/env bash

taxtrack_sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    LC_ALL=C LANG=C shasum -a 256 "$@"
  else
    sha256sum "$@"
  fi
}

taxtrack_sha256_stream() {
  if command -v shasum >/dev/null 2>&1; then
    LC_ALL=C LANG=C shasum -a 256
  else
    sha256sum
  fi
}

taxtrack_list_image_hash_files() {
  local root_dir="$1"
  shift

  if git -C "${root_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "${root_dir}" ls-files --cached --others --exclude-standard -- "$@"
    return
  fi

  local path
  for path in "$@"; do
    if [[ -f "${root_dir}/${path}" ]]; then
      printf '%s\n' "${path}"
    elif [[ -d "${root_dir}/${path}" ]]; then
      find "${root_dir}/${path}" -type f | sed "s#^${root_dir}/##"
    fi
  done
}

taxtrack_compute_image_source_hash() {
  local root_dir="$1"
  local image_name="$2"
  shift 2

  {
    printf 'cache-version %s\n' "1"
    printf 'image %s\n' "${image_name}"
    printf 'platform %s\n' "linux/amd64"

    taxtrack_list_image_hash_files "${root_dir}" "$@" | sort -u | while IFS= read -r file; do
      [[ -n "${file}" && -f "${root_dir}/${file}" ]] || continue
      printf 'file %s\n' "${file}"
      taxtrack_sha256_file "${root_dir}/${file}" | awk '{print $1}'
    done
  } | taxtrack_sha256_stream | awk '{print $1}'
}

taxtrack_image_repository_from_uri() {
  local image_uri="${1%@sha256:*}"
  local repository="${image_uri%:*}"

  if [[ "${repository}" == "${image_uri}" || "${repository}" != *"/"* ]]; then
    return 1
  fi

  printf '%s\n' "${repository}"
}

taxtrack_image_tag_from_uri() {
  local image_uri="${1%@sha256:*}"
  local repository

  repository="$(taxtrack_image_repository_from_uri "${image_uri}")" || return 1
  printf '%s\n' "${image_uri#"${repository}:"}"
}

taxtrack_ecr_image_exists() {
  local image_uri="$1"
  local aws_region="$2"
  local repository
  local repository_name
  local image_tag

  repository="$(taxtrack_image_repository_from_uri "${image_uri}")" || return 1
  image_tag="$(taxtrack_image_tag_from_uri "${image_uri}")" || return 1
  repository_name="${repository#*/}"

  aws ecr describe-images \
    --region "${aws_region}" \
    --repository-name "${repository_name}" \
    --image-ids "imageTag=${image_tag}" \
    >/dev/null 2>&1
}
