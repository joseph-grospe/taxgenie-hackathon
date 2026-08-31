#!/usr/bin/env bash
set -euo pipefail

stack="${PULUMI_STACK:-hackathon}"

pulumi --cwd backend/infra-gcp config set deploymentProfile hackathon --stack "${stack}"
pulumi --cwd backend/infra-gcp config set deployServices true --stack "${stack}"
pulumi --cwd backend/infra-gcp up --yes --stack "${stack}"
