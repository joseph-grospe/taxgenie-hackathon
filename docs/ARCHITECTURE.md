# Architecture - TaxTrack Manual Upload Platform

## Overview

TaxTrack uses a web-first intake architecture:

1. Authorized users upload PDFs in the TanStack Start app.
2. The browser sends files directly to S3 using presigned URLs.
3. The app validates each uploaded object and enqueues one SQS message per file.
4. The async worker consumes the queue and runs the document workflow.
5. Postgres stores intake, worker, and result state for status pages and downstream reporting.

## Primary Components

- `webapp/tax-track`
  - authenticated UI
  - upload and batch-status pages
  - protected API routes for presign, completion, and batch reads
- `backend/shared`
  - queue contracts
  - runtime env parsing
  - logging and tracing helpers
- `backend/worker`
  - SQS consumer
  - LangGraph workflow
  - artifact persistence and step logging
- `backend/infra`
  - bucket, queue, worker, and app wiring

## Request And Processing Path

```mermaid
flowchart LR
    U[User] --> UI[/upload page]
    UI --> P[POST /api/uploads/presign]
    P --> DB[(Postgres)]
    P --> S3[S3 source bucket]
    UI --> PUT[Direct S3 PUT]
    PUT --> C[POST /api/uploads/complete]
    C --> H[HeadObject validation]
    C --> Q[SQS queue]
    Q --> W[Worker]
    W --> AI[Extraction and normalization]
    W --> DB
    W --> A[S3 artifact bucket]
    DB --> B[/batch-status page]
```

## Data Model

- `intake_batches`: one row per upload session.
- `intake_files`: one row per uploaded file.
- `worker_jobs`: one row per worker processing run.
- `worker_job_steps`: step-level progress trail.
- `worker_idempotency`: replay protection.
- `document_results`: persisted processing result per uploaded file.

## Deployment Notes

- `web` scope can host the UI surface without the full processing path.
- `app` scope includes the upload path end to end: app, database, queue, worker, and storage access.
- `all` scope adds optional observability and broader platform services.

## Design Decisions

- Manual upload is the only supported intake channel.
- Queue submission is per file, not per batch.
- Uploads are single-part presigned `PUT` requests in v1.
- The worker uses event identity for idempotency instead of source-specific semantics.
