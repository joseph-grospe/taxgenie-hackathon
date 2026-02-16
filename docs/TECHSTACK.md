# Tech Stack - Project TaxTrack (BIR 2307 Automation)

This document defines the technology stack for TaxTrack based on the current repository and architecture direction.

## Stack by Layer

| Layer | Primary Technology | Purpose |
| --- | --- | --- |
| Frontend App | TanStack Start, React 19, TypeScript, Vite | Dashboard, batch status, validation review, reconciliation, and reporting UI |
| UI System | Tailwind CSS 4, Shadcn UI, CVA, Sonner | Minimalist and reusable component system |
| Backend API | FastAPI, Uvicorn, Pydantic Settings | HTTP API, configuration, orchestration |
| Document Processing | Python services/workers | OCR orchestration, normalization, validation, and report generation |
| Queue | AWS SQS | Decouple Drive ingestion from async processing |
| AI/OCR | Mistral Document AI, Azure OpenAI | OCR/layout extraction and structured normalization |
| Relational Data | PostgreSQL (RDS recommended) | Jobs, batches, metadata, extracted fields, validation results, audit logs |
| Object Storage | AWS S3, Azure Blob Storage (optional/secondary) | Source files, derived artifacts, reports, duplicates/errors |
| Source Intake | Google Drive API (`changes.watch`/`files.watch`, `changes.list`) | Detect and ingest new/updated source files from Drive |

## Cloud Topology Responsibilities

### AWS

- Lambda for webhook and web runtime entrypoints (as documented).
- SQS for processing queue.
- RDS PostgreSQL for transactional data.
- S3 for artifact storage.
- EC2 for sync engine and async workers.

### Azure

- Azure OpenAI for LLM-based structured extraction.
- Mistral Document AI for OCR/layout extraction.
- Azure Blob Storage for optional mirrored or primary artifacts.

### Google

- Google Drive API webhooks and change feed for ingestion triggers.

## Development Tooling

- Python environment and package management via `uv`.
- Frontend package management via `pnpm`.
- Frontend lint/format/test via `eslint`, `prettier`, and `vitest`.

## Required Environment Configuration

- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `DOCUMENT_INTELLIGENCE_API_KEY`
- `DOCUMENT_INTELLIGENCE_ENDPOINT`
- `CACHE_ENABLED`
