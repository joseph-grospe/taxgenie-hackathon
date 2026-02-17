#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "Created backend/local/.env from template"
fi

cd "$ROOT_DIR"
docker compose up -d

echo "Local infra is running:"
echo "- Postgres: localhost:5432"
echo "- ElectricSQL: localhost:5133"
