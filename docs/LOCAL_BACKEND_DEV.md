# Local Backend Development

## Goal

Run the TaxTrack app and worker locally against the current manual upload pipeline.

## Prerequisites

- Node.js and `pnpm`
- Python and `uv`
- AWS credentials with access to the deployed buckets and queue
- Postgres connection values required by the webapp and worker

## Install

```bash
pnpm install
uv pip install -r pyproject.toml
```

## Useful Commands

```bash
pnpm dev:web
pnpm dev:worker
pnpm db:generate:web
pnpm db:migrate:web
pnpm sst:dev
pnpm typecheck
pnpm test
```

## Environment Files

Use explicit env files instead of editing one shared `.env` for every workflow:

- `.env.local`: local web app and worker runtime. This should use local Postgres, local auth URL, and local-only SQS queues.
- `.env.dev`: deployed dev runtime and deploy scripts. This should mirror the current deployed dev values.
- `.env`: default fallback. Prefer `TAXTRACK_ENV_FILE` for day-to-day commands so the selected environment is obvious.

For local development:

```bash
TAXTRACK_ENV_FILE=.env.local pnpm dev:web
TAXTRACK_ENV_FILE=.env.local pnpm dev:worker
```

For deployed dev:

```bash
TAXTRACK_ENV_FILE=.env.dev pnpm run deploy:web
TAXTRACK_ENV_FILE=.env.dev pnpm run deploy:all
```

Use `deploy:web` for web-only application changes. Use `deploy:all` when infrastructure resources, runtime environment wiring, or shared platform resources need to change.

Keep S3 bucket settings consistent across the selected env file:

```bash
S3_BUCKET=<results-bucket>
S3_BUCKET_NAME=<source-bucket>
S3_SOURCE_BUCKET_NAME=<source-bucket>
S3_RESULTS_BUCKET_NAME=<results-bucket>
```

For the current dev/local setup, the source and results buckets may be the same bucket. Do not leave `S3_BUCKET` pointed at a deleted artifacts bucket; the worker and signature preview flows use it for result objects.

Local SQS should be separate from deployed dev SQS so local worker tests do not consume deployed dev messages.

## Recommended Local Flow

1. Start the web app with `TAXTRACK_ENV_FILE=.env.local pnpm dev:web`.
2. Start the worker with `TAXTRACK_ENV_FILE=.env.local pnpm dev:worker`.
3. Sign in with an `admin` or `editor` account.
4. Open `/upload` and upload one or more PDFs.
5. Confirm the files move through `uploaded`, `queued`, and worker states in `/upload` or `/batch-status`.

## Notes

- The source bucket must allow browser `PUT` and `HEAD` requests from your local origin.
- Queue submission happens after the app validates the uploaded object in S3.
- Database migrations for intake and worker state live under `webapp/tax-track/src/lib/migrations`.
- Restart the web app and worker after changing env files; both read env at process startup.
