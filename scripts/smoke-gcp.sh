#!/usr/bin/env bash
set -euo pipefail

project_id="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to the production GCP project.}"
region="${GCP_REGION:-asia-southeast1}"
domain="${TAXGENIE_DOMAIN:-taxgenie.online}"
bucket="${TAXGENIE_BUCKET_NAME:-${project_id}-taxgenie-production}"
stack="${PULUMI_STACK:-prod}"
load_balancer_ip="${TAXGENIE_LOAD_BALANCER_IP:-$(pulumi --cwd backend/infra-gcp stack output productionIpAddress --stack "${stack}")}"

if [[ -z "${load_balancer_ip}" ]]; then
  echo "The production load-balancer IP is not available." >&2
  exit 1
fi

health_ready=false
for _attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 20 \
    --resolve "${domain}:443:${load_balancer_ip}" \
    "https://${domain}/api/healthz" >/dev/null; then
    health_ready=true
    break
  fi
  sleep 20
done
if [[ "${health_ready}" != true ]]; then
  echo "The GCP load-balancer health endpoint did not become ready." >&2
  exit 1
fi

web_url="$(gcloud run services describe taxgenie-prod-web --project="${project_id}" --region="${region}" --format='value(status.url)')"
worker_url="$(gcloud run services describe taxgenie-prod-worker --project="${project_id}" --region="${region}" --format='value(status.url)')"

if curl --silent --output /dev/null --max-time 15 --write-out '%{http_code}' "${web_url}/api/healthz" | grep -Eq '^2'; then
  echo "Direct Cloud Run web access unexpectedly succeeded." >&2
  exit 1
fi
if curl --silent --output /dev/null --max-time 15 --write-out '%{http_code}' \
  --request POST --header 'content-type: application/json' --data '{"event":{}}' \
  "${worker_url}/tasks/document-extraction" | grep -Eq '^2'; then
  echo "Unauthenticated worker access unexpectedly succeeded." >&2
  exit 1
fi
if gcloud storage buckets get-iam-policy "gs://${bucket}" --project="${project_id}" \
  --format=json | grep -Eq 'allUsers|allAuthenticatedUsers'; then
  echo "The production bucket has a public IAM member." >&2
  exit 1
fi

echo "GCP service, ingress, authentication, and bucket-access smoke checks passed."
