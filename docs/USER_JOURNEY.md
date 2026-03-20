# User Journey - TaxTrack Manual Upload Flow

## 1. Sign In

- User signs in with a provisioned TaxTrack account.
- Access is role-based:
  - `admin` and `editor` can upload source files.
  - `viewer` can monitor downstream status but cannot upload.

## 2. Start An Upload Batch

- User opens `/upload`.
- User selects one or more BIR 2307 PDF files.
- TaxTrack creates a batch and shows per-file upload progress.

## 3. Direct File Upload

- The browser uploads each PDF directly to the source S3 bucket with a presigned `PUT` URL.
- Each file can succeed or fail independently.
- The UI keeps recent batch history visible even after refresh.

## 4. Queue Processing

- After a file finishes uploading, the app validates the stored object and queues one async job for that file.
- The user immediately sees whether the file is uploaded, queued, processing, completed, duplicated, or failed.

## 5. Worker Processing

- The worker extracts document text and structure.
- Normalization and validation rules run against the extracted content.
- Duplicate and invalid outputs are stored with their final status.

## 6. Monitor And Review

- `/upload` shows recent intake batches and per-file queue state.
- `/batch-status` shows worker progress and final processing outcomes.
- Downstream document and reporting pages consume the persisted results.
