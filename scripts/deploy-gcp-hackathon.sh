#!/usr/bin/env bash
set -euo pipefail

export TAXGENIE_DEPLOYMENT_PROFILE=hackathon
export PULUMI_STACK="${PULUMI_STACK:-hackathon}"

scripts/deploy-gcp-hackathon-bootstrap.sh
scripts/build-gcp-images.sh
scripts/deploy-gcp-hackathon-infra.sh
scripts/run-gcp-migrations.sh
scripts/smoke-gcp-hackathon.sh
