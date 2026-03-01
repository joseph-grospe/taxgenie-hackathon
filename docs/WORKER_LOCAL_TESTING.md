# Local Worker Testing Guide

This guide documents a reliable local flow for running the worker and firing a sample test event.

## 1) Prerequisites

- Node.js 22+
- pnpm 10+
- Docker (for local Postgres/ElectricSQL and Langfuse)
- AWS CLI v2 + configured profile (for S3/SQS access)

## 2) Environment setup

1. Copy sample env and load it in your shell:

```bash
cd /path/to/extract-bir-2307
cp .env.sample .env
source .env
```

2. At minimum for worker local runs, ensure these are set:

```bash
export AWS_REGION=${AWS_REGION:-ap-southeast-1}
export AWS_PROFILE=${AWS_PROFILE:-mac-bacon-profile}
export WORKER_TEST_QUEUE_URL=<your-worker-test-sqs-url>
export WORKER_TEST_S3_BUCKET=<your-test-s3-bucket>
export ADMIN_TOKEN=<admin-token>
export DATABASE_URL=postgresql://taxtrack:taxtrack@localhost:5432/taxtrack  # for local postgres mode
```

Optional local services:

```bash
export ELECTRICSQL_URL=http://localhost:5133
export LANGFUSE_ENABLED=true
export LANGFUSE_HOST=http://localhost:3001
export LANGFUSE_PUBLIC_KEY=<local-langfuse-public-key>
export LANGFUSE_SECRET_KEY=<local-langfuse-secret-key>
```

> For your worker command specifically, the minimal required env is usually:
>
> - `SQS_QUEUE_URL` (or `WORKER_TEST_QUEUE_URL`)
> - `S3_BUCKET` (or `WORKER_TEST_S3_BUCKET`)
> - `ADMIN_TOKEN`
> - `AWS_REGION`
> - `AWS_PROFILE`
>

## 3) Start local Postgres + ElectricSQL (recommended for worker tests)

From repo root:

```bash
cd backend/local
cp .env.example .env
./scripts/up.sh
```

This starts:

- Postgres: `localhost:5432`
- ElectricSQL: `localhost:5133`

## 4) Start local Langfuse

From repo root:

```bash
cd backend/langfuse
cp .env.example .env
./scripts/init.sh
```

If needed, override host before init:

```bash
export LANGFUSE_WEB_HOST_PORT=3001
export NEXTAUTH_URL=http://localhost:3001
```

Useful URL:

- `http://localhost:${LANGFUSE_WEB_HOST_PORT:-3001}`

## 5) Run the worker (from repo root)

```bash
SQS_QUEUE_URL="$WORKER_TEST_QUEUE_URL" \
S3_BUCKET="$WORKER_TEST_S3_BUCKET" \
ADMIN_TOKEN="$ADMIN_TOKEN" \
AWS_REGION="${AWS_REGION:-ap-southeast-1}" \
AWS_PROFILE="${AWS_PROFILE:-mac-bacon-profile}" \
pnpm --filter @taxtrack/worker dev
```

This runs `backend/worker/src/app.ts` directly via `pnpm --filter @taxtrack/worker dev`.

## 6) Emit a sample test event

From repo root, run:

```bash
pnpm dev:worker:test-event -- \
  --file "/Users/mharvicchicano/Downloads/Sample 2307/Scanned, image/BIR2307_BOHECO1_TMI_21119626_0124_20240223.pdf" \
  --source-file-id sample-local-doc-BIR2307_BOHECO1_TMI_21119626_0124_20240223 \
  --revision 1 \
  --mime-type application/pdf \
  --prefix worker-local-test-1
```

`triggerWorkerTestEvent` accepts `--bucket` and `--queue-url` too. If omitted, it uses:

- `WORKER_TEST_S3_BUCKET` / `S3_BUCKET`
- `WORKER_TEST_QUEUE_URL` / `SQS_QUEUE_URL`

Example with explicit bucket/queue:

```bash
pnpm dev:worker:test-event -- \
  --file "/Users/.../BIR2307_BOHECO1_TMI_21119626_0124_20240223.pdf" \
  --bucket "$WORKER_TEST_S3_BUCKET" \
  --queue-url "$WORKER_TEST_QUEUE_URL" \
  --source-file-id sample-local-doc-BIR2307_BOHECO1_TMI_21119626_0124_20240223 \
  --revision 1 \
  --mime-type application/pdf \
  --prefix worker-local-test-1
```

Dry-run mode (no upload/SQS send):

```bash
pnpm dev:worker:test-event -- --dry-run --file ".../file.pdf" --source-file-id ...
```

## 7) Verify a successful run

- Worker log should show end-to-end steps (`OCR extraction completed`, `Validation completed`, `Persisted validated document`, `Processed SQS message`).
- `decision.route` should be `continue` for successful flows.
- Output artifact usually appears under `results/<sourceFileId>/<revision>/...` in your configured bucket.

## 8) Stop local services

Postgres/ElectricSQL:

```bash
cd backend/local
./scripts/down.sh
```

Langfuse:

```bash
cd backend/langfuse
# from repo-local compose location
docker compose down
```

To fully reset Langfuse data volumes:

```bash
docker compose down -v
```
