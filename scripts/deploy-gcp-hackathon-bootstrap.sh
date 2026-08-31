#!/usr/bin/env bash
set -euo pipefail

project_id="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to the hackathon GCP project.}"
region="${GCP_REGION:-asia-southeast1}"
stack="${PULUMI_STACK:-hackathon}"
infra_dir="backend/infra-gcp"

required_apis=(
  artifactregistry.googleapis.com cloudbuild.googleapis.com
  cloudtasks.googleapis.com iam.googleapis.com iamcredentials.googleapis.com
  logging.googleapis.com run.googleapis.com secretmanager.googleapis.com
  serviceusage.googleapis.com storage.googleapis.com
)

gcloud services enable "${required_apis[@]}" --project="${project_id}"

pushd "${infra_dir}" >/dev/null
pulumi stack select "${stack}" 2>/dev/null || pulumi stack init "${stack}"
pulumi config set gcp:project "${project_id}"
pulumi config set deploymentProfile hackathon
pulumi config set region "${region}"
if ! pulumi config get deployServices >/dev/null 2>&1; then
  pulumi config set deployServices false
fi
pulumi config set enableDnsCutover false

missing_secrets=()
for secret_name in \
  geminiApiKey betterAuthSecret databaseUrl migrationDatabaseUrl \
  seedEmail seedPassword; do
  if ! pulumi config get "${secret_name}" >/dev/null 2>&1; then
    missing_secrets+=("${secret_name}")
  fi
done
if ((${#missing_secrets[@]} > 0)); then
  echo "Set these encrypted Pulumi values before bootstrap: ${missing_secrets[*]}" >&2
  echo "Use: pulumi config set --secret <name> '<value>'" >&2
  exit 1
fi

pulumi up --yes
popd >/dev/null
