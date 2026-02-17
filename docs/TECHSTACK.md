# Tech Stack - TaxTrack (BIR 2307 Automation)

This document reflects the current architecture direction shown in the latest system diagram.

## Backend Implementation Stack

| Concern | Technology | Notes |
| --- | --- | --- |
| Infra as Code | SST + Pulumi AWS | SST app orchestration with Pulumi AWS resources for EC2-heavy topology |
| Webhook Service | TypeScript Lambda (`backend/lambda`) | API Gateway HTTP API -> Lambda -> SQS |
| Queue Consumer | TypeScript Worker (`backend/worker`) | Express health/admin + long-poll SQS consumer |
| Orchestration | LangGraph JS | Agent workflow orchestration in worker runtime |
| DB Access + Migrations | Drizzle ORM + drizzle-kit | Postgres schema and migration management |
| Shared Contracts | Zod + shared package (`backend/shared`) | Queue contracts, env validation, logging/tracing utilities |
| CI/CD | GitHub Actions | CI typechecks and stage deployments (`dev`/`prod`) |
| Local Observability | Docker Compose Langfuse (`backend/langfuse`) | Local tracing during webhook + worker development |

## Core Runtime Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Web App | TanStack Start, React, TypeScript | User-facing UI with realtime connectivity to the sync engine |
| Sync Engine | `electricSQL` on AWS EC2 | Realtime sync/orchestration layer between web app and data services |
| Relational Data | AWS RDS (PostgreSQL) | Primary state and database for the sync/worker flows |
| Queueing | AWS SQS | Decouples webhook ingestion from async processing |
| Webhook Ingestion | AWS Lambda | Producer that receives webhook events and enqueues jobs to SQS |
| Source Intake | Google Drive API (`changes.watch`/`files.watch`, `changes.list`) | Detects new/updated source files and triggers ingestion |
| Async Processing (Path Forward - Option 1) | AWS EC2 worker | Consumer that runs the end-to-end agent workflow |
| LLM Observability | Langfuse on AWS EC2 | Tracing/observability for LLM-driven workflow execution |
| AI Extraction + Logic | Mistral Document AI, Azure OpenAI | Document extraction + LLM reasoning/validation |
| Artifact Storage | AWS S3 | Persists generated outputs/artifacts from worker runs |

## Primary Architecture Path (Option 1)

Current preferred direction is an EC2-based async worker:

- `Lambda` (webhook) publishes to `SQS`.
- `SQS` is consumed by an `Async Worker` running on EC2.
- Worker reads/writes state in `RDS`.
- Worker sends LLM traces to `Langfuse` (EC2).
- Worker persists run outputs to `S3`.
- Initial test target is a small EC2 instance.

## Queue Roles and Ownership Notes

- Producer: Webhook Lambda publishes jobs to SQS.
- Consumer: Async Worker (EC2) pulls and processes SQS jobs.
- Dev TODO (diagram note): webhook-to-SQS setup is tracked under Seph.

## Agent Workflow (per run)

Estimated max runtime per run: ~3 minutes.

1. File download
2. Document extraction via Mistral Document AI
3. LLM logic via Azure OpenAI
4. Validation and checks
5. Save outputs to S3

## Google + Azure Context

- Google Drive is the upstream document source; file changes are detected via Drive webhook/change APIs and pushed into the ingestion pipeline.
- Mistral Document AI handles document extraction (OCR/layout understanding) before downstream validation.
- Azure OpenAI handles LLM-based reasoning, normalization, and validation logic on top of extracted content.
- These Google/Azure services integrate into the AWS runtime path (`Lambda -> SQS -> EC2 worker`) for processing.

## Alternative Architecture (Option 2)

Alternative considered in the diagram:

- `SQS` consumer on `AWS Lambda` instead of EC2 worker.
- Main concern: LangGraph and LangChain compatibility/reliability in serverless runtime.

## Why EC2 Is Preferred Right Now

- Better fit for current LangGraph execution characteristics.
- Fewer known issues versus serverless for this workflow.
- Supports team learning and faster debugging for long-lived worker behavior.

## Future Optimization Notes

- Keep worker on-demand where possible.
- Offload infrastructure pieces to managed AWS services over time (where practical).
- Review moving Langfuse dependencies (for example S3/Redis responsibility) as observability setup matures.
