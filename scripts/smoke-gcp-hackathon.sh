#!/usr/bin/env bash
set -euo pipefail

project_id="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to the hackathon GCP project.}"
region="${GCP_REGION:-asia-southeast1}"
stack="${PULUMI_STACK:-hackathon}"
: "${TAXGENIE_SEED_EMAIL:?Set TAXGENIE_SEED_EMAIL for the sign-in smoke test.}"
: "${TAXGENIE_SEED_PASSWORD:?Set TAXGENIE_SEED_PASSWORD for the sign-in smoke test.}"

web_url="$(pulumi --cwd backend/infra-gcp stack output webServiceUrl --stack "${stack}")"
worker_url="$(pulumi --cwd backend/infra-gcp stack output workerServiceUrl --stack "${stack}")"
bucket="$(pulumi --cwd backend/infra-gcp stack output storageBucket --stack "${stack}")"

if [[ -z "${web_url}" || -z "${worker_url}" || -z "${bucket}" ]]; then
  echo "Hackathon service outputs are incomplete." >&2
  exit 1
fi

health_ready=false
for _attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 20 "${web_url}/api/healthz" >/dev/null; then
    health_ready=true
    break
  fi
  sleep 10
done
if [[ "${health_ready}" != true ]]; then
  echo "The public hackathon web health endpoint did not become ready." >&2
  exit 1
fi

worker_status="$(curl --silent --output /dev/null --max-time 20 \
  --write-out '%{http_code}' --request POST \
  --header 'content-type: application/json' --data '{"event":{}}' \
  "${worker_url}/tasks/document-extraction" || true)"
if [[ "${worker_status}" =~ ^2 ]]; then
  echo "Unauthenticated worker access unexpectedly succeeded." >&2
  exit 1
fi

if gcloud storage buckets get-iam-policy "gs://${bucket}" \
  --project="${project_id}" --format=json | \
  grep -Eq 'allUsers|allAuthenticatedUsers'; then
  echo "The hackathon bucket has a public IAM member." >&2
  exit 1
fi

sign_in_status="$(curl --silent --output /dev/null --max-time 20 \
  --write-out '%{http_code}' --request POST \
  --header 'content-type: application/json' \
  --header "origin: ${web_url}" \
  --data "{\"email\":\"${TAXGENIE_SEED_EMAIL}\",\"password\":\"${TAXGENIE_SEED_PASSWORD}\"}" \
  "${web_url}/api/auth/sign-in/email")"
if [[ ! "${sign_in_status}" =~ ^2 ]]; then
  echo "Seeded administrator sign-in failed with HTTP ${sign_in_status}." >&2
  exit 1
fi

echo "Hackathon web, worker IAM, bucket privacy, and seeded sign-in checks passed."
