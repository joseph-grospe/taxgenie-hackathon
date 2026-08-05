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
    P --> S3[S3 storage bucket]
    UI --> PUT[Direct S3 PUT]
    PUT --> C[POST /api/uploads/complete]
    C --> H[HeadObject validation]
    C --> Q[SQS queue]
    Q --> W[Worker]
    W --> AI["Gemini 3 Flash Preview extraction"]
    W --> V["Local signature visual detector"]
    W --> T["PDF text-layer signer recovery"]
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
- `document_results`: one current business outcome per upload; retries keep the row ID stable.
- `document_extraction_attempts`: internal execution, reliability, latency, and token-usage history for initial processing, manual retries, and claim takeovers.
- `extracted_certificates`: effective/queryable child certificate projections.
- `certificate_tax_rows`: detailed ATC and amount rows per certificate.
- `certificate_override_requests` and `certificate_override_changes`: audited human corrections that never rewrite a structurally valid extraction payload.

## Extraction Boundary

The worker sends the complete original PDF inline to the Gemini Developer API once using the exact `gemini-3-flash-preview` model ID, high thinking, medium PDF resolution, and strict `DocumentExtractionResultV1` structured output. Gemini decides whether the file contains zero, one, or multiple BIR 2307 certificates and independently populates every detected certificate.

Local PDF processing determines and persists the physical page count and validates page assignments against the complete response. When Gemini reports fewer pages, the worker ignores the difference only when the exact deficit consists of unassigned pages that render completely white; the ignored physical page numbers remain in processing audit metadata. Nonblank, referenced, ambiguous, and unrenderable pages retain strict mismatch handling. A one-certificate file follows the normal artifact and downstream workflow, including certificates that span several pages. When a file contains multiple certificates, the worker retains only the certificate with the lowest page number (Gemini response order breaks ties), runs its normal validation and masterlist resolution, persists its projection and tax rows for review, and finishes the document as an error. Discarded certificates retain only response-order and page-number audit metadata; their extracted tax data is not persisted.

Multi-certificate errors do not qualify for dedupe, numbering, certificate-PDF generation, reconciliation, signing, or correction. They remain visible in the batch BIR 2307 workbook as `ERROR` rows with duplicate status `UNKNOWN`. No OCR transcript, page Markdown, prompt, thoughts, PDF bytes, or raw provider response is persisted.

When Gemini does not confirm a signature or does not provide a trusted printed name, the local visual detector inspects the payor signer region. It may promote signature presence only at confidence `0.86` or higher with a visible payor signer band. PDF text-layer extraction may recover printed signer identity fields when visual evidence exists, but cannot establish signature presence.

Gemini is the sole extraction provider. Certificate consumers—including signing, merging, reconciliation, overrides, and exports—reference child certificate IDs and effective relational projections.

Manual extraction retries update the payload-less current result only when it is
still the latest retryable provider failure. Each worker claim creates a separate
internal extraction attempt so token usage, latency, and provider reliability are
retained without exposing historical blank result rows to client-facing views.

## Deployment Notes

- `web` scope can host the UI surface without the full processing path.
- `app` scope includes the upload path end to end: app, database, queue, worker, and storage access.
- `all` scope adds optional observability and broader platform services.

## Design Decisions

- Manual upload is the only supported intake channel.
- Queue submission is per file, not per batch.
- Uploads are single-part presigned `PUT` requests in v1.
- The worker uses event identity for idempotency instead of source-specific semantics.
