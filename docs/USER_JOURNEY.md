# User Journey - Project TaxTrack

This journey reflects the production operating model where source 2307 files are uploaded to Google Drive, not directly uploaded to the TaxTrack platform.

```mermaid
flowchart TD
    A[Login] --> B[Dashboard]
    B --> C[Connect or Select Google Drive Source]
    C --> D[Drive Upload by Revenue Team]
    D --> E[Webhook Detects New or Updated File]
    E --> F[Auto Batch Creation and Processing]
    F --> G[Live Processing Status]
    G --> H[Review Duplicates and Errors]
    H --> I[Validated Results]
    I --> J[Reconciliation]
    J --> K[Generate and Download Reports]
    K --> L[Audit Trail]
```

## 1) Login and Dashboard

- User signs in and lands on operations dashboard.
- Dashboard shows recent batches, queue status, error counts, and reconciliation progress.

## 2) Configure Data Source (One-Time Setup)

- Admin connects the organization Google Drive account.
- Admin selects the source folder for BIR 2307 files.
- System registers watch channel and stores channel metadata.

## 3) Revenue Team Uploads to Google Drive

- Revenue team continues their current behavior: upload/download files in Google Drive.
- No manual source upload is required inside TaxTrack.

## 4) Automatic Intake via Webhook

- Drive webhook notifies TaxTrack of new or modified files.
- Intake service validates the event and reads change tokens.
- Matching files are queued for processing.
- Existing/current files can be ingested through backfill sync.

## 5) Live Processing Visibility

- Users monitor stages: queued -> OCR -> extraction -> validation -> reconciliation -> done/failed.
- Each file has timestamps, status reason, and confidence information.

## 6) Duplicate and Error Handling

- Duplicate files are automatically segregated and tagged with reason.
- Invalid records (missing fields, signature/printed name issues, ATC/variance failures) move to error queue.
- Users review details and decide reprocess/escalation actions.

## 7) Validated Outputs and Storage

- Valid files are renamed using `Co.Name_TIN_PeriodEnd_Sequence`.
- Processed artifacts are stored in S3 and/or Azure Blob Storage.
- Structured extraction results are persisted for downstream reporting.

## 8) Reconciliation

- Revenue book data is loaded for reconciliation.
- System matches extracted CWT details against book records.
- Monthly and quarterly reconciliation statuses are computed.

## 9) Reporting and Export

- User generates consolidated reconciliation reports.
- Reports are downloadable and retained in cloud storage.

## 10) Audit and Support

- All ingestion, processing, and user actions are logged for traceability.
- Support workflow follows agreed hypercare and maintenance commitments.
