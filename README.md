# TaxGenie (BIR 2307 Automation)

TaxGenie automates BIR 2307 intake, extraction, validation, duplicate handling, reconciliation, and audit visibility.

## Current Operating Model

- Authenticated `admin` and `editor` users upload one or more PDF source documents in the TaxGenie web app.
- The app creates a batch, issues presigned S3 `PUT` URLs, and the browser uploads each PDF directly to the configured storage bucket.
- After each upload completes, the app validates the object in S3 and sends one SQS message per file.
- The async worker sends each original PDF to Gemini once, validates the structured certificate results, persists relational projections and certificate artifacts, and writes status back to Postgres.
- `/upload` and `/batch-status` read persisted intake and worker state so progress survives refreshes and restarts.

## What The System Delivers

- Multi-file PDF upload with per-file queueing and retry handling.
- Whole-document Gemini detection with one supported BIR 2307 certificate per uploaded PDF; multi-certificate files retain the earliest extraction for review and finish as errors.
- Rule-based validation, ATC-based checks, and duplicate detection.
- Entity-scoped source, processing, certificate, signature, and export artifacts in S3.
- Batch, file, and worker-level operational visibility in the app.
- Reconciliation-ready records and downloadable outputs.
- Audit-friendly state transitions and user attribution.

## Repository Layout

- `app/`: FastAPI service and Python extraction modules.
- `modules/`: supporting Python modules for extraction flows.
- `webapp/tax-genie/`: TanStack Start frontend and server routes.
- `backend/shared/`: shared TypeScript contracts, env parsing, logging, and tracing.
- `backend/worker/`: async worker that consumes SQS and runs the LangGraph workflow.
- `backend/infra/`: SST and Pulumi infrastructure definitions.
- LangSmith Cloud provides optional workflow tracing; local tracing is disabled by default.

## Workspace Commands

From the repository root:

```bash
pnpm install
pnpm dev:web
pnpm dev:worker
pnpm deploy:worker
pnpm db:generate:web
pnpm db:migrate:web
pnpm sst:dev
pnpm sst:deploy:dev
pnpm sst:deploy:prod
pnpm typecheck
pnpm test
```

Use `TAXGENIE_ENV_FILE` to select the intended environment file:

```bash
TAXGENIE_ENV_FILE=.env.local pnpm dev:web
TAXGENIE_ENV_FILE=.env.local pnpm dev:worker
TAXGENIE_ENV_FILE=.env.dev pnpm run deploy:web
TAXGENIE_ENV_FILE=.env.dev pnpm run deploy:all
```

See [Local Backend Dev](docs/runbooks/LOCAL_BACKEND_DEV.md) for the local/dev env split and deployment notes.

## Frontend Commands

```bash
pnpm --dir webapp/tax-genie dev
pnpm --dir webapp/tax-genie build
pnpm --dir webapp/tax-genie test
```

Frontend deploys use a local build cache at `.taxgenie-build-cache/web`.
Runtime-only env changes reuse the previous TanStack Start `.output`; source,
config, lockfile, shared package, or client-exposed `import.meta.env.*` changes
trigger a rebuild. Use `TAXGENIE_WEB_BUILD_FORCE=1 pnpm run deploy:web` to force
a fresh build.

Worker deploys persist source hashes in the selected env file. If worker or
merge-worker source inputs are unchanged, `pnpm deploy:worker` and
`pnpm deploy:merge-worker` reuse the last pushed ECR image and still run SST so
runtime env changes apply. Use `TAXGENIE_WORKER_IMAGE_FORCE=1` or
`TAXGENIE_MERGE_WORKER_IMAGE_FORCE=1` to rebuild the image.

## Backend Commands

```bash
uv pip install -r pyproject.toml
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Related Docs

- [Docs Index](docs/README.md)
- [Project Summary](docs/product/PROJECT_SUMMARY.md)
- [Architecture](docs/architecture/ARCHITECTURE.md)
- [Tech Stack](docs/architecture/TECHSTACK.md)
- [Local Backend Dev](docs/runbooks/LOCAL_BACKEND_DEV.md)
