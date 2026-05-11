# Uncommitted Changes Summary

Generated from the current worktree on 2026-04-25.

## Snapshot

- Tracked changes against `HEAD`: 74 files changed, about 10,598 insertions and 3,091 deletions.
- Untracked files are also present and are listed separately below.
- The overall direction of the work is a shift from a batch-oriented upload flow to a single-upload, multi-certificate workflow with stronger duplicate detection and richer operations UI.

## Major Themes

1. The ingestion model is moving away from `intake_batches`.
2. The worker now supports multi-page / multi-certificate uploads instead of assuming a single result per upload.
3. Duplicate detection was expanded substantially:
   - duplicate pages inside the same PDF
   - same source file revision replay protection
   - same original filename
   - same uploaded file hash
   - same normalized certificate data fingerprint
4. The web app upload area was redesigned around a single-upload intake workflow with attention handling instead of batch monitoring.
5. Document operations pages now expose richer upload-level and certificate-level detail, including batch summaries, related certificates, processing trails, and issue-resolution actions.

## Backend And Worker Changes

### Infrastructure and shared contract

- `backend/infra/compute-worker.ts`
- `backend/shared/src/config/env.ts`
- `backend/shared/src/contracts/queue-event.ts`
- `backend/worker/src/consumer/messageHandler.ts`

Summary:

- Increased default Mistral and Azure OpenAI timeouts from `60000` ms to `180000` ms.
- Removed `batchId` from the shared queue event contract and from worker message handling.
- Removed worker-side batch status refresh logic, which matches the larger removal of `intake_batches`.

### Worker schema and migrations

- `backend/worker/src/db/schema.ts`
- `backend/worker/src/db/progress.ts`
- `backend/worker/src/db/migrations/0004_remove_intake_batches.sql`
- `backend/worker/src/db/migrations/0005_multi_certificate_results.sql`
- `backend/worker/src/db/migrations/0006_dedupe_lookup_columns.sql`
- `backend/worker/src/db/migrations/meta/_journal.json`

Summary:

- Deleted the worker schema definition for `intake_batches`.
- Removed `batch_id` from `intake_files`, `worker_jobs`, and `document_results`.
- Added `document_kind` and `page_number` to `document_results` so one upload can persist upload-level rows and per-certificate rows.
- Added `original_file_name`, `source_hash`, and `data_fingerprint` columns plus lookup indexes for dedupe queries.
- Added a unique guard on `(upload_id, document_kind, COALESCE(page_number, -1))`.
- Removed the old batch-progress refresh helper from `progress.ts`.

### LangGraph workflow changes

- `backend/worker/src/langgraph/graph.ts`
- `backend/worker/src/langgraph/types.ts`
- `backend/worker/src/langgraph/nodes/checkDuplicatePage.ts`
- `backend/worker/src/langgraph/nodes/checkMasterlist.ts`
- `backend/worker/src/langgraph/nodes/dedupeCheck.ts`
- `backend/worker/src/langgraph/nodes/extractDocument.ts`
- `backend/worker/src/langgraph/nodes/normalizeFields.ts`
- `backend/worker/src/langgraph/nodes/persistDuplicate.ts`
- `backend/worker/src/langgraph/nodes/persistResults.ts`
- `backend/worker/src/langgraph/nodes/persistValidationFail.ts`
- `backend/worker/src/langgraph/nodes/validateRules.ts`
- `backend/worker/src/langgraph/services/azureNormalizerClient.ts`
- `backend/worker/src/langgraph/services/mistralClient.ts`

Summary:

- Added page-level workflow state with `pages` and upload-level `batchSummary` to the graph state.
- Reworked the workflow around per-page certificate processing instead of a single normalized document blob.
- Added page classification and page splitting support so the worker can distinguish certificate pages from non-certificate pages.
- `checkDuplicatePage` now uses dedicated page-processing helpers and records duplicate page numbers in `batchSummary`.
- `checkMasterlist` now validates certificate pages individually and records failed page numbers instead of treating the upload as one flat document.
- `dedupeCheck` became much richer and now checks:
  - previous `sourceFileId + revision`
  - same original filename
  - same source hash
  - same normalized data fingerprint at page level and upload level
- Persistence nodes now save upload-level and page-level dedupe metadata so future runs can match against prior successes, duplicates, and validation failures.
- Parsing and normalization logic was expanded to normalize more date formats and build stable dedupe inputs.

### New worker utilities and tests

- `backend/worker/src/langgraph/utils/dedupe.ts`
- `backend/worker/src/langgraph/utils/pageProcessing.ts`
- `backend/worker/src/langgraph/utils/parsing.ts`
- `backend/worker/src/langgraph/utils/dedupe.test.ts`
- `backend/worker/src/langgraph/utils/pageProcessing.test.ts`
- `backend/worker/src/langgraph/utils/parsing.test.ts`
- `backend/worker/package.json`
- `backend/worker/tsconfig.json`

Summary:

- Added new dedupe helper utilities for canonical data fingerprints, batch fingerprints, stored-payload fingerprint extraction, and duplicate matching.
- Added page-processing helpers for PDF page splitting, OCR text extraction, certificate detection, and in-file duplicate page detection.
- Added tests for dedupe, page classification / duplicate-page detection, and date normalization.
- Added `pdf-lib` dependency for PDF page splitting.
- Updated TypeScript config to exclude `*.test.ts` from the worker build.

## Frontend Data And Schema Changes

### App schema and migrations

- `webapp/tax-track/src/lib/schema.ts`
- `webapp/tax-track/src/lib/migrations/0006_strong_blue_marvel.sql`
- `webapp/tax-track/src/lib/migrations/0007_multi_certificate_results.sql`
- `webapp/tax-track/src/lib/migrations/0008_dedupe_lookup_columns.sql`
- `webapp/tax-track/src/lib/migrations/0009_attention_resolution.sql`
- `webapp/tax-track/src/lib/migrations/meta/0006_snapshot.json`
- `webapp/tax-track/src/lib/migrations/meta/_journal.json`

Summary:

- Mirrored the backend schema changes in the web app database layer:
  - removed `intake_batches`
  - removed `batch_id`
  - added `document_kind`
  - added `page_number`
  - added dedupe lookup columns and indexes
- Added upload attention tracking fields on `intake_files`:
  - `attention_status`
  - `attention_resolved_at`
  - `attention_resolved_by_user_id`

### Intake server and types

- `webapp/tax-track/src/lib/intake-server.ts`
- `webapp/tax-track/src/lib/intake-server.test.ts`
- `webapp/tax-track/src/lib/intake-utils.ts`
- `webapp/tax-track/src/lib/upload-intake-types.ts`
- `webapp/tax-track/src/lib/upload-intake-view-model.ts`
- `webapp/tax-track/src/lib/upload-intake-view-model.test.ts`

Summary:

- Replaced batch-based upload creation with single-file upload creation.
- `presign` now accepts one file instead of an array of files.
- Added `listRecentUploads()` and upload-level status summary generation.
- Added parsing of upload result summaries from `batchSummary` or from certificate result rows.
- Added attention-resolution server support for duplicate/error uploads.
- Added new upload-intake frontend view models for:
  - current upload card
  - queue metrics
  - jobs table
  - needs-attention panel
- Removed old batch status derivation utilities.

## Frontend API And Route Changes

- `webapp/tax-track/src/routes/api/uploads/presign.ts`
- `webapp/tax-track/src/routes/api/uploads/complete.ts`
- `webapp/tax-track/src/routes/api/uploads/recent.ts`
- `webapp/tax-track/src/routes/api/uploads/resolve-attention.ts`
- `webapp/tax-track/src/routes/api/batches.ts` deleted
- `webapp/tax-track/src/routes/api/batches.$batchId.ts` deleted
- `webapp/tax-track/src/routes/api/uploads/batches.ts` renamed to `webapp/tax-track/src/routes/api/uploads/recent.ts`
- `webapp/tax-track/src/routes/api/users/create.ts`
- `webapp/tax-track/src/routeTree.gen.ts`

Summary:

- Upload API moved from batch terminology to upload terminology.
- Added a dedicated `GET /api/uploads/recent` endpoint for the redesigned upload intake page.
- Added `POST /api/uploads/resolve-attention` so users can clear duplicate/error uploads from the attention queue.
- Removed the old batch API routes entirely.
- `routeTree.gen.ts` was regenerated to reflect route additions, removals, and renames.
- `api/users/create.ts` only appears to have formatting/import wrapping changes.

## Frontend UI Changes

### Upload intake redesign

- `webapp/tax-track/src/routes/upload.tsx`
- `webapp/tax-track/src/components/upload-intake-page.tsx`

Summary:

- Replaced the old multi-file, batch-centric upload page with a single-upload workflow page.
- Added a large current-upload card with stage tracking and action buttons.
- Added guardrail messaging around:
  - one PDF per upload
  - multi-certificate support inside one PDF
  - non-2307 pages being ignored
  - persistence only after validation
- Added queue metrics, a needs-attention panel, and a jobs table tied to recent uploads.
- Added client logic for:
  - selecting one PDF
  - presigning one upload
  - queueing one upload
  - polling recent uploads
  - resolving attention items

### Document detail and issue review

- `webapp/tax-track/src/routes/documents.$docId.tsx`
- `webapp/tax-track/src/components/document-detail-page.tsx`
- `webapp/tax-track/src/components/document-detail-page.test.tsx`
- `webapp/tax-track/src/lib/documents-types.ts`
- `webapp/tax-track/src/lib/documents-server.ts`
- `webapp/tax-track/src/routes/error-detail.tsx`
- `webapp/tax-track/src/routes/issues.tsx`

Summary:

- Added a new workflow-oriented `DocumentDetailPage` component.
- Extended document view types with:
  - `kind` (`upload` vs `certificate`)
  - `attentionStatus`
  - `attentionResolvedAt`
  - `pageNumber`
  - `batchSummary`
  - `relatedDocuments`
  - `trailDetails`
- `documents-server.ts` now builds richer operational document views, including:
  - upload-level batch summaries
  - processing trails and trail details
  - validation checks
  - review fields
  - related generated certificate records
  - upload attention state
- `error-detail.tsx` now loads live document data by `docId` and `errorIndex` instead of using mock data.
- `issues.tsx` now uses the updated operational document shape and no longer displays batch metadata.

### Shared shell and navigation updates

- `webapp/tax-track/src/components/app-shell.tsx`
- `webapp/tax-track/src/components/site-header.tsx`
- `webapp/tax-track/src/components/app-sidebar.tsx`
- `webapp/tax-track/src/lib/access-control.ts`
- `webapp/tax-track/src/lib/access-control.test.ts`
- `webapp/tax-track/src/routes/batch-status.tsx` deleted

Summary:

- Added support for `leadingActions` and optional support-button visibility in the page shell/header.
- Removed the `Batch Status` navigation item and route.
- Removed route-access handling for the deleted batch-status screen.
- `access-control.test.ts` also has local formatting changes.

### Other UI refinements

- `webapp/tax-track/src/components/status-pill.tsx`
- `webapp/tax-track/src/components/validated-documents-panel.tsx`
- `webapp/tax-track/src/routes/reconciliation.tsx`
- `webapp/tax-track/src/components/reconciliation-results-table.tsx`

Summary:

- Expanded `StatusPill` coverage for labels like `Completed`, `Failed`, and `Needs Review`.
- Removed batch references from validated document detail surfaces.
- Reworked reconciliation page layout and controls for a more dashboard-like presentation.
- Added selected-row support and richer empty-state styling to the reconciliation results table.
- `validated-documents-panel.tsx` is mostly cleanup / formatting plus removal of batch-related UI output.

## Docs And Supporting Files

- `docs/plans/CERTIFICATE_DUPLICATE_CHECKING_PLAN.md`
- `pnpm-lock.yaml`

Summary:

- Added a substantial implementation note describing the certificate duplicate-checking flow and porting guidance.
- `pnpm-lock.yaml` changed to capture new dependency updates, including worker-side additions like `pdf-lib`.

## Untracked Files

These files are present locally but are not tracked yet:

- `.env.mac`
- `.env.seph`
- `docs/CERTIFICATE_DUPLICATE_CHECKING_PLAN.txt`
- `webapp/tax-track/.env.mac`
- `webapp/tax-track/.env.seph`

Notes:

- The `.env.*` files look like local environment-specific configuration and should be reviewed before committing.
- `docs/CERTIFICATE_DUPLICATE_CHECKING_PLAN.txt` appears to be an untracked companion or alternate export of the tracked Markdown plan.

## Short Version

If this work were summarized in one sentence: the repo is being refactored from batch-based intake into upload-based, multi-certificate processing with page-aware dedupe, richer persistence metadata, attention resolution, and a much more operationally useful frontend.
