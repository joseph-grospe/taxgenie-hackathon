# TaxTrack Bottleneck Review for 3,000 Documents per Month

## Summary

TaxTrack is expected to handle around 3,000 uploaded 2307 documents per month. That average volume is modest, roughly 100 documents per day, but the important production risk is burst load. If most documents are uploaded near a cutoff date, one batch, one reconciliation cycle, or one signing cycle, the system may experience short periods of much higher pressure.

The highest-risk bottlenecks are expected to be worker throughput, OCR/AI rate limits, reconciliation matching, polling/read pressure, and downstream PDF signing or merge workflows. The database should be manageable at this volume if the dashboard and operational queries remain indexed, but it still needs monitoring as yearly data grows.

## Volume Assumptions

- Estimated upload volume: 3,000 documents per month.
- Estimated yearly volume: 36,000 documents per year.
- Average daily volume: about 100 documents per day.
- Risk scenario: 1,000 to 3,000 documents uploaded in a short cutoff window.
- Each uploaded document may create multiple database records across intake files, worker jobs, worker steps, document results, artifacts, reconciliation rows, and audit fields.

## High-Risk Bottlenecks

### 1. Worker Throughput

Each uploaded document becomes an asynchronous processing job. If worker concurrency is too low, the queue can build up quickly during cutoff periods.

What to monitor:

- SQS queue depth.
- Oldest message age.
- Worker jobs completed per minute.
- Worker failure and retry counts.
- Dead-letter queue count.

Recommended action:

- Define expected processing throughput, for example documents per hour.
- Load test a burst upload scenario.
- Tune worker concurrency and retry behavior.

### 2. OCR / Document Intelligence Rate Limits

OCR is likely one of the slowest parts of the pipeline. External API rate limits, latency, and transient failures can directly control total processing speed.

What to monitor:

- OCR request duration.
- OCR throttling responses.
- OCR error rate.
- OCR retries.

Recommended action:

- Confirm service quotas with the expected burst volume.
- Add alerts for throttling and slow extraction.
- Use retry backoff so failed jobs do not overwhelm the provider.

### 3. AI Normalization and Validation Calls

If documents are passed through AI-based normalization or validation after OCR, token limits, request-per-minute limits, latency, and cost can become bottlenecks.

What to monitor:

- AI request duration.
- AI token usage.
- AI rate-limit responses.
- AI retry count.
- Cost per document.

Recommended action:

- Track average and p95 processing time per document.
- Confirm model/API quotas.
- Add fallback and retry handling for rate-limited calls.

### 4. Reconciliation Matching

Reconciliation can be heavier than document upload because one reconciliation sheet can contain many rows. Matching rows to certificates and calculating differences may become slow as data grows.

What to monitor:

- Reconciliation import duration.
- Number of rows per reconciliation file.
- Matching query duration.
- Rows inserted or replaced per import.
- Reconciliation API response time.

Recommended action:

- Index fields used for matching, especially certificate identity, TIN, dates, and upload/result references.
- Test reconciliation with realistic large workbooks.
- Avoid loading unnecessary history when matching a selected period.

### 5. Dashboard Summary Queries

Monthly dashboard views should be fine at 3,000 documents, but yearly views may read 36,000+ document records plus reconciliation rows and artifacts.

What to monitor:

- Dashboard API p95 latency.
- Database slow queries.
- Query plans for monthly, quarterly, and yearly filters.
- Number of active dashboard viewers.

Recommended action:

- Keep upload-date and download-date indexes in place.
- Avoid full-table scans for dashboard metrics.
- Consider cached summaries or materialized aggregates later if yearly dashboard latency grows.

### 6. Status Polling and Operational Pages

Dashboard polling, batch-status pages, and validated-document views can multiply read load when many users are watching the same process.

What to monitor:

- Requests per minute to dashboard and batch-status endpoints.
- Average active users during cutoff processing.
- DB reads caused by polling endpoints.

Recommended action:

- Keep dashboard polling at a conservative interval.
- Poll only when the browser tab is visible.
- Consider server push or event-based status updates later if polling becomes expensive.

### 7. Database Connection Pool Pressure

Uploads, workers, reconciliation, dashboards, signing, merge jobs, and downloads all use database connections. Under burst load, the connection pool may become saturated.

What to monitor:

- Active database connections.
- Pool wait time.
- Query duration.
- Transaction duration.
- Worker connection usage.

Recommended action:

- Set separate pool sizing expectations for web requests and worker processes.
- Keep worker transactions short.
- Add slow-query logging in staging and production.

### 8. Retry Storms

When an external service slows down or fails, many jobs may retry at the same time. This can make the system slower even after the external service recovers.

What to monitor:

- Retry count per job.
- Retry rate per minute.
- DLQ messages.
- External provider error rates.

Recommended action:

- Use exponential backoff.
- Cap retries.
- Make DLQ triage part of operations.

## Medium-Risk Bottlenecks

### 9. Upload Completion and Queueing

The browser uploads files directly to S3, which helps avoid app-server bandwidth pressure. However, the app still creates presigned URLs, records intake rows, completes uploads, and sends queue messages.

Recommended action:

- Load test large batches.
- Confirm the upload-complete endpoint handles many files efficiently.
- Keep queueing idempotent.

### 10. Large Files and No Multipart Upload

If users upload large PDFs, single-request uploads are harder to resume and more likely to fail on unstable networks.

Recommended action:

- Track file size distribution.
- Set practical file-size limits.
- Consider multipart upload if large PDFs are common.

### 11. Worker Job Step Table Growth

Each document can create several worker step rows. At 3,000 documents per month, this may become tens of thousands of step rows per month.

Recommended action:

- Monitor worker step table size.
- Index job/result lookup paths.
- Define retention rules for low-value historical step detail.

### 12. JSON Payload Growth

Document payloads, validation details, and reconciliation metadata may be stored as JSON. Large JSON fields can increase storage, backup time, and query cost.

Recommended action:

- Keep frequently filtered fields normalized in columns.
- Avoid filtering dashboards directly on large JSON payloads.
- Monitor table and index bloat.

### 13. Duplicate Detection

Duplicate checks can slow down as document history grows, especially if matching scans old results or compares large payloads.

Recommended action:

- Ensure duplicate keys are indexed.
- Prefer normalized identity fields over payload scanning.
- Track duplicate-check duration.

### 14. Masterlist and Entity Lookup

Matching by TIN, customer name, short name, or normalized names may become slow if masterlist data grows without proper indexes.

Recommended action:

- Index lookup fields used by matching.
- Normalize TIN and name values consistently.
- Track lookup duration during extraction and reconciliation.

### 15. PDF Signing

Signing many PDFs may consume CPU, memory, and storage I/O, especially if PDFs are loaded fully into memory.

Recommended action:

- Track signing duration per document.
- Track memory usage during batch signing.
- Process large signing batches asynchronously.

### 16. PDF Merge Jobs

Merged output generation depends on AWS Batch capacity, container resources, S3 read/write speed, and output PDF size.

Recommended action:

- Monitor merge job queue time.
- Monitor merge job duration.
- Validate resources for large batches.
- Alert on failed merge jobs.

### 17. Signed PDF Download Path

If signed PDFs are streamed through the app server, concurrent downloads can consume app memory and bandwidth. Merge outputs that use presigned S3 URLs are less risky.

Recommended action:

- Prefer presigned S3 download paths where possible.
- Keep download tracking lightweight.
- Monitor large or repeated downloads.

### 18. Excel and Report Exports

Large exports can be CPU and memory heavy if generated synchronously.

Recommended action:

- Generate large exports asynchronously.
- Store generated exports in S3.
- Add size and duration monitoring.

## Operational Bottlenecks

### 19. Manual Review Queue

Bad, duplicate, or error documents may become a human bottleneck. Even if the system processes documents quickly, unresolved exceptions can delay collection and reconciliation.

Recommended action:

- Track count of bad/error/duplicate documents.
- Track age of unresolved documents.
- Add clear ownership for manual review.

### 20. Uncollected Reconciliation Follow-Up

Uncollected rows may represent a business-process bottleneck rather than a system bottleneck.

Recommended action:

- Track average days uncollected.
- Track oldest uncollected items.
- Add operational follow-up ownership.

### 21. Observability Gaps

Without visibility into queues, jobs, external calls, and slow queries, bottlenecks will be hard to diagnose during cutoff periods.

Recommended action:

- Add dashboards or alerts for queue depth, worker throughput, OCR/AI latency, database slow queries, dashboard API latency, reconciliation duration, signing duration, merge duration, and DLQ count.

### 22. Retention and Archiving

The yearly document count is not huge, but generated artifacts, JSON payloads, worker steps, reconciliation rows, and PDFs will accumulate.

Recommended action:

- Define retention for worker logs and intermediate artifacts.
- Archive older artifacts when appropriate.
- Monitor backup size and restore time.

## Recommended Team Priorities

1. Load test the end-to-end flow with a realistic burst, not only the monthly average.
2. Confirm OCR and AI service quotas for cutoff-period traffic.
3. Monitor SQS queue age, worker throughput, and DLQ count.
4. Add or verify database indexes for dashboard filters, reconciliation matching, downloads, and duplicate checks.
5. Keep polling conservative and visible-tab-only.
6. Measure reconciliation import and matching duration with large real workbooks.
7. Validate signing and merge performance for large batches.
8. Define operational ownership for bad documents, duplicates, and uncollected rows.

## Current Readiness Assessment

At 3,000 documents per month, the expected volume is reasonable for the current architecture if the workload is spread out. The main concern is not the average monthly count; it is concentrated upload and processing bursts. The system should be treated as production-ready only after burst testing, queue monitoring, external API quota validation, and slow-query monitoring are in place.
