#!/usr/bin/env bash
set -euo pipefail

project_id="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to the target GCP project.}"
region="${GCP_REGION:-asia-southeast1}"
deployment_profile="${TAXGENIE_DEPLOYMENT_PROFILE:-production}"
stack="${PULUMI_STACK:-$([[ "${deployment_profile}" == "hackathon" ]] && echo hackathon || echo prod)}"
job_name="$(pulumi --cwd backend/infra-gcp stack output migrationJobName --stack "${stack}")"
job_name="${job_name##*/}"

if [[ -z "${job_name}" ]]; then
  echo "The migration job output is not available for stack ${stack}." >&2
  exit 1
fi

gcloud run jobs execute "${job_name}" \
  --project="${project_id}" \
  --region="${region}" \
  --wait
