# TaxTrack (BIR 2307 Automation)

TaxTrack automates BIR 2307 intake, extraction, validation, duplicate handling, reconciliation, and audit visibility.

## Current Operating Model

- Authenticated `admin` and `editor` users upload one or more PDF source documents in the TaxTrack web app.
- The app creates a batch, issues presigned S3 `PUT` URLs, and the browser uploads each PDF directly to the configured storage bucket.
- After each upload completes, the app validates the object in S3 and sends one SQS message per file.
- The async worker consumes the queue, runs OCR and normalization, applies business rules, persists artifacts, and writes status back to Postgres.
- `/upload` and `/batch-status` read persisted intake and worker state so progress survives refreshes and restarts.

## What The System Delivers

- Multi-file PDF upload with per-file queueing and retry handling.
- OCR and structured field extraction for BIR 2307 documents.
- Rule-based validation, ATC-based checks, and duplicate detection.
- Entity-scoped source, processing, certificate, signature, and export artifacts in S3.
- Batch, file, and worker-level operational visibility in the app.
- Reconciliation-ready records and downloadable outputs.
- Audit-friendly state transitions and user attribution.

## Repository Layout

- `app/`: FastAPI service and Python extraction modules.
- `modules/`: supporting Python modules for extraction flows.
- `webapp/tax-track/`: TanStack Start frontend and server routes.
- `backend/shared/`: shared TypeScript contracts, env parsing, logging, and tracing.
- `backend/worker/`: async worker that consumes SQS and runs the LangGraph workflow.
- `backend/infra/`: SST and Pulumi infrastructure definitions.
- `backend/langfuse/`: local Langfuse stack for tracing during development.

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

Use `TAXTRACK_ENV_FILE` to select the intended environment file:

```bash
TAXTRACK_ENV_FILE=.env.local pnpm dev:web
TAXTRACK_ENV_FILE=.env.local pnpm dev:worker
TAXTRACK_ENV_FILE=.env.dev pnpm run deploy:web
TAXTRACK_ENV_FILE=.env.dev pnpm run deploy:all
```

See [Local Backend Dev](docs/LOCAL_BACKEND_DEV.md) for the local/dev env split and deployment notes.

## Frontend Commands

```bash
pnpm --dir webapp/tax-track dev
pnpm --dir webapp/tax-track build
pnpm --dir webapp/tax-track test
```

## Backend Commands

```bash
uv pip install -r pyproject.toml
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Related Docs

- [Project Summary](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/docs/PROJECT_SUMMARY.MD)
- [Architecture](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/docs/ARCHITECTURE.md)
- [Tech Stack](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/docs/TECHSTACK.md)
- [Local Backend Dev](/Users/mharvicchicano/projects/side/bacon/bir2307/extract-bir-2307/docs/LOCAL_BACKEND_DEV.md)
