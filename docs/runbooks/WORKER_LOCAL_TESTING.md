# Local Worker Testing Guide

This guide documents a reliable local flow for running the worker alongside the local web app.

## 1) Prerequisites

- Node.js 22+
- pnpm 10+
- Docker (for local Postgres)
- AWS CLI v2 + configured profile (for S3/SQS access)

## 2) Environment setup

1. Use the local env file for worker testing:

```bash
cd /path/to/extract-bir-2307
[ -f .env.local ] || cp .env.sample .env.local
```

2. At minimum for worker local runs, ensure these are set:

```bash
export AWS_REGION=${AWS_REGION:-ap-southeast-1}
export AWS_PROFILE=${AWS_PROFILE:-mac-bacon-profile}
export SQS_QUEUE_URL=<your-sqs-url>
export S3_BUCKET_NAME=<your-taxtrack-storage-bucket>
export S3_OBJECT_PREFIX=v2
export ADMIN_TOKEN=<admin-token>
export DATABASE_URL=postgresql://taxtrack:taxtrack@localhost:5432/taxtrack  # for local postgres mode
```

Prefer one AWS credential source in `.env.local`. Use either `AWS_PROFILE` or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, not both. For local development, `AWS_PROFILE` is usually safer.

Use separate local SQS queues from deployed dev, for example:

```bash
export SQS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/<account-id>/taxtrack-local
export SQS_DLQ_URL=https://sqs.ap-southeast-1.amazonaws.com/<account-id>/taxtrack-local-dlq
```

Keep `S3_BUCKET_NAME` pointed at a bucket that exists in the AWS account/profile selected by `.env.local`.

Optional LangSmith Cloud tracing:

```bash
export TAXTRACK_LANGSMITH_ENABLED=true
export LANGSMITH_API_KEY=<workspace-scoped-service-key>
export LANGSMITH_ENDPOINT=https://apac.api.smith.langchain.com
export LANGSMITH_PROJECT=taxtrack-dev
export LANGCHAIN_CALLBACKS_BACKGROUND=true
```

Leave `TAXTRACK_LANGSMITH_ENABLED=false` for normal local work that should not emit cloud traces. Do not set `LANGSMITH_TRACING`; TaxTrack supplies an explicit redacting callback.

> For your worker command specifically, the minimal required env is usually:
>
> - `SQS_QUEUE_URL`
> - `S3_BUCKET_NAME`
> - `ADMIN_TOKEN`
> - `AWS_REGION`
> - `AWS_PROFILE`

## 3) Start local Postgres (recommended for worker tests)

From repo root:

```bash
cd backend/local
cp .env.example .env
./scripts/up.sh
```

This starts Postgres on `localhost:5432`.

## 4) Run the worker (from repo root)

```bash
TAXTRACK_ENV_FILE=.env.local pnpm dev:worker
```

This runs `backend/worker/src/app.ts` directly via `pnpm --filter @taxtrack/worker dev`.

Run the merge worker with the same local env when testing a specific merge job:

```bash
TAXTRACK_ENV_FILE=.env.local MERGE_JOB_ID=<job-id> pnpm dev:merge-worker
```

For local-only merge testing from the app, set this in `.env.local` and restart
the web app:

```bash
MERGE_JOBS_SKIP_AWS_BATCH=true
```

With that flag enabled, creating a merge job in the UI only writes the merge
manifest to Postgres. It does not submit AWS Batch. The job remains `pending`
until you run the local merge worker.

Or use the local helper script, which can list recent merge jobs and validate the
job manifest before running:

```bash
./scripts/test-merge-worker-local.sh --list
TAXTRACK_ENV_FILE=.env.local pnpm test:merge-worker -- <job-id>
```

Use Docker mode if you do not want to install `qpdf` on the host:

```bash
TAXTRACK_ENV_FILE=.env.local pnpm test:merge-worker -- --docker <job-id>
```

## 5) Verify a successful run

- Start the web app and upload a PDF through `/upload`.
- Worker log should show end-to-end steps (`Agent extraction completed`, `Certificate validation completed`, `Agentic document result persisted`, `Processed SQS message`).
- `decision.route` should be `continue` for successful flows.
- Output artifacts usually appear under `v2/entities/{entityKey}/customers/{customerKey}/processing/...` and `v2/entities/{entityKey}/customers/{customerKey}/certificates/...` in your configured bucket.
- When tracing is enabled, verify one redacted root trace in the `taxtrack-dev` LangSmith project.

## 6) Stop local services

Postgres:

```bash
cd backend/local
./scripts/down.sh
```
