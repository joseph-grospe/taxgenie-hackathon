#!/usr/bin/env bash
set -euo pipefail

stack="${PULUMI_STACK:-prod}"

scripts/build-gcp-images.sh
pulumi --cwd backend/infra-gcp config set deployServices true --stack "${stack}"
pulumi --cwd backend/infra-gcp up --yes --stack "${stack}"
scripts/run-gcp-migrations.sh
scripts/smoke-gcp.sh
