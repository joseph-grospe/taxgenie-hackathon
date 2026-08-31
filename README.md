# TaxGenie (BIR 2307 Automation)

TaxGenie automates BIR 2307 intake, extraction, validation, duplicate handling, reconciliation, and audit visibility.

## Production Operating Model

- Authenticated `admin` and `editor` users upload one or more PDF source documents in the TaxGenie web app.
- The Cloud Run web service creates a batch, issues 15-minute GCS V4 `PUT` URLs, and the browser uploads each PDF directly to the private production bucket.
- After each upload completes, the app validates its GCS generation and creates one deterministic Cloud Task per file.
- Cloud Tasks invokes the private Cloud Run worker, which sends each original PDF to pinned `gemini-3.5-flash`, validates the structured result, and persists data through the Cloud SQL Unix socket.
- `/upload` and `/batch-status` read persisted intake and worker state so progress survives refreshes and restarts.

## What The System Delivers

- Multi-file PDF upload with per-file queueing and retry handling.
- Whole-document Gemini detection with one supported BIR 2307 certificate per uploaded PDF; multi-certificate files retain the earliest extraction for review and finish as errors.
- Rule-based validation, ATC-based checks, and duplicate detection.
- Entity-scoped source, processing, certificate, signature, and export artifacts in GCS.
- Batch, file, and worker-level operational visibility in the app.
- Reconciliation-ready records and downloadable outputs.
- Audit-friendly state transitions and user attribution.

## Repository Layout

- `app/`: FastAPI service and Python extraction modules.
- `modules/`: supporting Python modules for extraction flows.
- `webapp/tax-genie/`: TanStack Start frontend and server routes.
- `backend/shared/`: shared TypeScript contracts, env parsing, logging, and tracing.
- `backend/worker/`: private HTTP worker invoked by Cloud Tasks.
- `backend/infra-gcp/`: active production Pulumi infrastructure.
- `backend/infra/`: retained legacy AWS SST/Pulumi infrastructure; never destroy it as part of GCP deployment.
- LangSmith Cloud provides optional workflow tracing; local tracing is disabled by default.

## Workspace Commands

From the repository root:

```bash
pnpm install
pnpm dev:web
pnpm dev:worker
pnpm deploy:bootstrap
pnpm deploy:images
pnpm deploy:all
pnpm db:generate:web
pnpm db:migrate:web
pnpm typecheck
pnpm test
```

Use `TAXGENIE_ENV_FILE` to select the intended environment file:

```bash
TAXGENIE_ENV_FILE=.env.local pnpm dev:web
TAXGENIE_ENV_FILE=.env.local pnpm dev:worker
```

See [GCP infrastructure](backend/infra-gcp/README.md) and the [production cutover runbook](backend/infra-gcp/CUTOVER.md).
For the separate Neon Free judging environment, use the
[near-zero hackathon runbook](backend/infra-gcp/HACKATHON.md).

## Frontend Commands

```bash
pnpm --dir webapp/tax-genie dev
pnpm --dir webapp/tax-genie build
pnpm --dir webapp/tax-genie test
```

Production builds run in Cloud Build and are deployed by immutable Artifact
Registry digest. The migration job runs the canonical web migration directory
before the post-deployment smoke checks.

## Backend Commands

```bash
uv pip install -r pyproject.toml
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Production boundary

The GCP database and bucket start empty. Merge, outbound email, and permanent
purge are disabled in production. AWS remains intact only as a rollback/archive
environment and the GCP runtime contains no AWS credentials or calls.
