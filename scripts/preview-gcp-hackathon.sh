#!/usr/bin/env bash
set -euo pipefail

stack="${PULUMI_STACK:-hackathon}"

pulumi --cwd backend/infra-gcp config set deploymentProfile hackathon --stack "${stack}"
pulumi --cwd backend/infra-gcp config set deployServices true --stack "${stack}"
pulumi --cwd backend/infra-gcp preview --stack "${stack}" --json | \
  node scripts/assert-hackathon-preview.mjs
