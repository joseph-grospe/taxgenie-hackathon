#!/usr/bin/env bash
set -euo pipefail

project_id="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to the target GCP project.}"
region="${GCP_REGION:-asia-southeast1}"
deployment_profile="${TAXGENIE_DEPLOYMENT_PROFILE:-production}"
stack="${PULUMI_STACK:-$([[ "${deployment_profile}" == "hackathon" ]] && echo hackathon || echo prod)}"
revision="${TAXGENIE_IMAGE_TAG:-$(git rev-parse --short=12 HEAD)}"
repository_id="$(pulumi --cwd backend/infra-gcp stack output artifactRepositoryId --stack "${stack}")"
registry="${region}-docker.pkg.dev/${project_id}/${repository_id}"

gcloud auth configure-docker "${region}-docker.pkg.dev" --quiet

for component in web worker migrator; do
  image="${registry}/${component}:${revision}"
  gcloud builds submit . \
    --project="${project_id}" \
    --region="${region}" \
    --config="cloudbuild/${component}.yaml" \
    --substitutions="_IMAGE=${image}"

  digest="$(gcloud artifacts docker images describe "${image}" \
    --project="${project_id}" \
    --format='value(image_summary.digest)')"
  if [[ -z "${digest}" ]]; then
    echo "Could not resolve the immutable digest for ${image}." >&2
    exit 1
  fi
  pulumi --cwd backend/infra-gcp config set "${component}Image" \
    "${registry}/${component}@${digest}" --stack "${stack}"
done
