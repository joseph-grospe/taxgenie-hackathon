# Batch Active TAT Implementation Plan

## Summary
Replace the dashboard’s current `Ave. TAT` calculation with **average active processing time per completed batch**.

A batch qualifies only when:
- Its upload date is inside the selected dashboard period.
- It has at least one successful document.
- Every successful document in the batch is included in a downloaded merged output.
- Required stage timings are measured; no historical fallback.

The batch TAT value is the **union of active intervals** across upload, validation, plotting, reconciliation, signing, merge, and download, so parallel work and idle gaps are not overcounted.

## Key Changes
- Add a `batch_stage_timings` table and Drizzle schema entry for measured app-owned stages:
  `upload`, `plotting`, `reconciliation`, `signing`, `merge`, `download`.
  Include `batchId`, `stage`, `startedAt`, `finishedAt`, `durationMs`, `dedupeKey`, `sourceType`, `sourceId`, `metadata`, and `createdAt`.

- Extend upload completion:
  `POST /api/uploads/complete` accepts client-measured `uploadStartedAt` and `uploadFinishedAt`.
  The upload page records the XHR PUT window and sends it when queueing the file.

- Add timing capture for:
  - reconciliation import route: split successful work into `plotting` for row-to-certificate matching and `reconciliation` for the remaining import/persist work
  - document and batch signing routes: record active signing request windows
  - merge status sync: record merge active time from AWS Batch `startedAt` to `finishedAt`, per batch represented in the merge inputs
  - merge output download route: record server request-handling time for first downloaded merge outputs

- Replace dashboard TAT fetching/calculation:
  - Remove the old `firstDownloadedAt - uploadDate` sample logic.
  - Add `fetchBatchTatSamples(period)` that finds upload-period batches, verifies final merge download completion for all successful docs, gathers measured intervals, unions overlaps, and averages per-batch active milliseconds.
  - Keep metric id `averageTat`, but update display text to something like `Ave. Batch TAT`, detail `Active time to final download`, and empty state `No completed batches`.

## Interfaces
- `completeUploadSchema` gains optional ISO timestamp fields:
  `uploadStartedAt`, `uploadFinishedAt`.
- Dashboard calculation input changes from document-level TAT samples to batch-level active interval samples.
- No UI layout change is required; the existing metric card can render the renamed metric.

## Test Plan
- Dashboard unit tests:
  - averages active TAT per batch
  - excludes idle gaps
  - merges overlapping intervals so parallel work counts once
  - excludes batches without complete measured stages
  - excludes batches where not all successful docs are in downloaded merge outputs
  - attributes batches by upload date, not final download date

- Route/service tests:
  - upload completion records upload timing when timestamps are supplied
  - reconciliation import records separate plotting and reconciliation timings on success
  - signing records timing for single-document and batch signing
  - merge output first download records download request timing
  - repeated calls do not duplicate timing rows when a dedupe key is present

## Assumptions
- “Plotting” means reconciliation row-to-certificate matching.
- “Download time” means server request-handling/download URL preparation time, not full browser/S3 transfer time.
- Duplicate/error documents do not block batch TAT completion; only successful documents must be signed, merged, and downloaded.
- Batches with no successful documents are excluded from the average.
- Historical batches without the new timing records are excluded instead of estimated.
