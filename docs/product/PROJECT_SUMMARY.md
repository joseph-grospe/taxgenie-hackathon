# Project Summary - TaxTrack (BIR 2307 Automation)

TaxTrack is an AI-assisted BIR 2307 processing platform that accepts manual PDF uploads, validates extracted fields, detects duplicates, and produces reconciliation-ready outputs.

## Operating Model

- Source documents are uploaded directly in TaxTrack by authenticated `admin` and `editor` users.
- Each upload session creates a persisted batch and one intake record per file.
- The browser uploads PDFs directly to the source S3 bucket using presigned URLs.
- The app validates each completed upload and enqueues one SQS message per file.
- The async worker consumes the queue and runs extraction, normalization, validation, dedupe, persistence, and reconciliation steps.

## Primary Outcomes

- Reduced manual data entry for BIR 2307 processing.
- Clear operational visibility for uploaded files and processing batches.
- Safer async processing through persisted intake state and worker idempotency.
- Audit-friendly tracking of who uploaded each source file and how it moved through the pipeline.

## Core Capabilities

- Manual multi-file PDF intake.
- Whole-document Gemini structured extraction.
- ATC-based validation and variance checks.
- Duplicate detection and segregation.
- Renamed output artifacts and structured JSON results.
- Batch, file, and worker status pages backed by Postgres.
- Reconciliation-ready exports and audit logs.

## TypeScript Backend Packages

- `backend/shared`: shared contracts and runtime config helpers.
- `backend/worker`: SQS consumer and LangGraph workflow runtime.
- `backend/infra`: SST and Pulumi deployment definitions.
- `backend/worker/src/observability`: redacted LangSmith Cloud tracing for worker execution.
