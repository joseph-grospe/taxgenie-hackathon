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
pnpm dev:worker:test-event
pnpm db:generate:web
pnpm db:migrate:web
pnpm sst:dev
pnpm typecheck
pnpm test
```

## Recommended Local Flow

1. Start the web app with `pnpm dev:web`.
2. Start the worker with `pnpm dev:worker`.
3. Sign in with an `admin` or `editor` account.
4. Open `/upload` and upload one or more PDFs.
5. Confirm the files move through `uploaded`, `queued`, and worker states in `/upload` or `/batch-status`.

## Notes

- The source bucket must allow browser `PUT` and `HEAD` requests from your local origin.
- Queue submission happens after the app validates the uploaded object in S3.
- `pnpm dev:worker:test-event` is useful when you want to verify the worker path without using the browser upload flow.
- Database migrations for intake and worker state live under `webapp/tax-track/src/lib/migrations`.
