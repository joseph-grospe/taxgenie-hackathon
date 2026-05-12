# Backend Implementation Plan - Manual Upload Intake

## Scope

Implement a hard cutover to authenticated manual PDF upload with direct S3 transfer and SQS-driven async processing.

## Public Interfaces

- `POST /api/uploads/presign`
- `POST /api/uploads/complete`
- `GET /api/uploads/batches`
- `GET /api/batches`
- `GET /api/batches/:batchId`

## Responsibilities

### App runtime

- authorize `admin` and `editor` access to upload routes
- create intake batch and file records
- generate presigned S3 `PUT` URLs
- validate uploaded objects with `HeadObject`
- publish `DocumentIngestEventV1` messages to SQS
- expose DB-backed batch and file status endpoints

### Worker runtime

- consume SQS messages
- enforce idempotency
- run extraction, normalization, validation, and dedupe
- persist artifacts, results, and worker step logs
- refresh batch and file status

## Event Contract

`DocumentIngestEventV1` includes:

- `eventId`
- `traceId`
- `source`
- `batchId`
- `uploadId`
- `sourceFileId`
- `revision`
- `originalFileName`
- `mimeType`
- `sizeBytes`
- `artifactUri`
- `uploadedByUserId`
- `uploadedAt`
- `receivedAt`

## Storage Conventions

- Raw upload key format: `v2/entities/{entityKey}/intake/{YYYY}/{MM}/{DD}/{batchId}/{uploadId}/source.pdf`
- Derived artifact key format: `v2/entities/{entityKey}/customers/{customerKey}/...`
- One queue message per file
- `sourceFileId = uploadId`
- `revision = S3 versionId`, falling back to ETag when versioning metadata is not available

## Persistence

- `intake_batches`
- `intake_files`
- `worker_jobs`
- `worker_job_steps`
- `worker_idempotency`
- `document_results`

## Acceptance Criteria

- only authenticated `admin` and `editor` users can upload
- only PDFs are accepted
- upload completion is replay-safe
- status pages read persisted data instead of in-memory client state
- no active runtime path depends on an external document listener
