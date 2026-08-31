#!/usr/bin/env bash
set -euo pipefail

project_id="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to the production GCP project.}"
region="${GCP_REGION:-asia-southeast1}"
domain="${TAXGENIE_DOMAIN:-taxgenie.online}"
stack="${PULUMI_STACK:-prod}"
infra_dir="backend/infra-gcp"

required_apis=(
  artifactregistry.googleapis.com certificatemanager.googleapis.com
  cloudbuild.googleapis.com cloudtasks.googleapis.com compute.googleapis.com
  dns.googleapis.com iam.googleapis.com iamcredentials.googleapis.com
  logging.googleapis.com
  monitoring.googleapis.com run.googleapis.com secretmanager.googleapis.com
  serviceusage.googleapis.com sqladmin.googleapis.com storage.googleapis.com
)

gcloud services enable "${required_apis[@]}" --project="${project_id}"

pushd "${infra_dir}" >/dev/null
pulumi stack select "${stack}" 2>/dev/null || pulumi stack init "${stack}"
pulumi config set gcp:project "${project_id}"
pulumi config set region "${region}"
pulumi config set domain "${domain}"

if ! pulumi config get deployServices >/dev/null 2>&1; then
  pulumi config set deployServices false
fi
if ! pulumi config get enableDnsCutover >/dev/null 2>&1; then
  pulumi config set enableDnsCutover false
fi

missing_secrets=()
for secret_name in geminiApiKey betterAuthSecret dbPassword seedEmail seedPassword; do
  if ! pulumi config get "${secret_name}" >/dev/null 2>&1; then
    missing_secrets+=("${secret_name}")
  fi
done
if ((${#missing_secrets[@]} > 0)); then
  echo "Set these encrypted Pulumi values before bootstrap: ${missing_secrets[*]}" >&2
  echo "Example: pulumi config set --secret geminiApiKey '<value>'" >&2
  exit 1
fi

pulumi up --yes
popd >/dev/null
