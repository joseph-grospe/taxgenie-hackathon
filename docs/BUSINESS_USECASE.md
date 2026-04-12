# Business Use Case - TaxTrack Manual Upload Intake

## Problem

Revenue teams receive large volumes of BIR 2307 certificates in PDF form. Manual review and re-encoding of the documents is slow, error-prone, and difficult to audit.

## Goal

Provide a controlled platform where authorized users can upload source PDFs, track each file through extraction and validation, and produce reconciliation-ready outputs without relying on an external intake listener.

## Primary Users

- `admin`: manages users, access, and operational oversight.
- `editor`: uploads source files and monitors batch progress.
- `viewer`: reads downstream status and reporting pages without upload access.

## Target Operating Flow

1. An authorized user opens `/upload` and selects one or more PDFs.
2. TaxTrack creates a batch and presigned upload targets.
3. The browser uploads files directly to S3.
4. The app validates each object and queues one async job per file.
5. The worker extracts and normalizes document data.
6. Validation, duplicate checks, and persistence complete in the worker.
7. Users monitor progress in `/upload` and `/batch-status`.
8. Validated results feed downstream reconciliation and reporting.

## Business Value

- Removes manual intake handling outside the platform.
- Gives operations an explicit audit trail from upload through processing.
- Supports partial success in large batches instead of failing all files together.
- Reduces processing latency by uploading directly from the browser to S3.
- Keeps the worker path asynchronous and retry-safe through SQS and idempotency records.

## Non-Goals For This Cutover

- No redesign of business-level duplicate rules beyond exact replay protection.
- No multipart upload support in v1.
- No new intake channel outside authenticated manual upload.
