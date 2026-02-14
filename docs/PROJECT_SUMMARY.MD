# Project Summary - Project TaxTrack (BIR 2307 Automation)

Project TaxTrack automates BIR 2307 processing, validation, and reconciliation in line with `docs/original_requirement/requirement.md`.

The solution combines webhook-driven file intake, AI extraction, rule-based validation, and reconciliation reporting to reduce manual work and improve compliance.

## Operating Model Update

- Source files are not uploaded directly in TaxTrack by end users.
- Revenue team uploads or maintains 2307 files in a designated Google Drive folder.
- The Drive folder and webhook integration are preconfigured by a Super Admin (one-time); regular users do not connect or select Drive sources from the dashboard.
- TaxTrack listens to Drive file events through webhook integration and automatically ingests new/current files for processing.
- Processed outputs and reports are saved to S3 and/or Azure Blob Storage.

## What the System Delivers

### 1) Automated Intake From Google Drive

- Initial backfill for existing files already present in the target Drive folder (folder scan + enqueue).
- Catch-up sync using Drive `changes.list` to avoid missing updates during the backfill window.
- Drive webhook listener for new/updated files after the initial backfill is complete.
- Event validation, change-token tracking, and idempotent enqueueing.

### 2) AI-Powered Extraction

- OCR/layout extraction for native and scanned PDFs.
- LLM-based normalization of required BIR 2307 fields.
- Field-level confidence capture for quality monitoring.

### 3) Validation and Exception Routing

- Required field checks for payee/payor details, TIN, ATC, tax base, tax withheld, printed name, and signature.
- Automated error tagging and routing to exception storage/work queues.
- Strict handling of incomplete or inconsistent documents.

### 4) ATC-Based Tax Base Verification

- ATC rate mapping with initial coverage:
1. `WC160 = 2%`
2. `WC158 = 1%`
3. `WC051 = 15%`
- Work-back tax base calculation from tax withheld.
- Variance rule: `<= PHP 100` valid; `> PHP 100` error.
- Extensible design for additional ATC codes.

### 5) Duplicate Segregation

- Duplicate detection using file identity and business keys.
- Segregation to dedicated duplicate storage path.
- Duplicate records excluded from final reconciliation counts.

### 6) Naming Convention Automation

- Renames valid files to `Co.Name_TIN_PeriodEnd_Sequence`.
- Uses TIN and provided masterlist mapping as reference.

### 7) Reconciliation and Reporting

- Matches extracted data against Revenue prepaid CWT records.
- Produces monthly and quarterly reconciliation outputs.
- Supports downloadable reports and cloud-stored artifacts.

### 8) Storage and Data Management

- Structured metadata and statuses in Postgres.
- Raw, processed, duplicate, and error artifacts in S3 and/or Azure Blob Storage.
- Configurable retention and lifecycle controls.

### 9) Auditability and Observability

- End-to-end audit trail for ingestion, extraction, validation, and user actions.
- Processing telemetry for queue lag, errors, retries, and throughput.
- Operational dashboards for batch and document-level visibility.

### 10) Security and Confidentiality

- Encryption in transit and at rest.
- Least-privilege access for Drive, AI, queue, and storage services.
- Controlled access to sensitive tax data and immutable audit logs.

### 11) UAT and Data Volume Readiness

- Supports requirement-aligned UAT scenarios for native/scanned PDFs, error cases, and complete/blank datasets.
- Designed for high-volume batch processing with asynchronous workers.

### 12) Post-Go-Live Support

- Hypercare period and support SLAs per agreed terms.
- Maintenance and update process for rule changes, bug fixes, and platform stability.

## One-Line Summary

TaxTrack is a Google Drive-integrated, AI-assisted BIR 2307 automation platform that turns uploaded tax certificates into validated, reconciled, and audit-ready outputs stored in enterprise cloud storage.
