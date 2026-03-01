#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "Created backend/langfuse/.env from template"
else
  echo "Using existing backend/langfuse/.env"
fi

# Append any newly introduced keys from .env.example into .env without
# overwriting user-specific values.
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  key="${line%%=*}"
  [[ -z "$key" ]] && continue

  if ! grep -q "^${key}=" "$ROOT_DIR/.env"; then
    echo "$line" >> "$ROOT_DIR/.env"
    echo "Added missing env key: ${key}"
  fi
done < "$ROOT_DIR/.env.example"

cd "$ROOT_DIR"
docker compose pull
docker compose up -d --force-recreate

LANGFUSE_WEB_URL="http://localhost:${LANGFUSE_WEB_HOST_PORT:-3001}"
echo "Langfuse local stack is running at ${LANGFUSE_WEB_URL}"
