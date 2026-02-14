# Workflow Diagram

## High Level Flow

```mermaid
flowchart TD
    A[Super Admin configures Drive folder one-time] --> B[Initial backfill: scan existing files]
    B --> C[Queue processing jobs]
    D[Revenue Team uploads 2307 to Google Drive folder] --> E[Google Drive webhook notification]
    E --> F[TaxTrack intake service validates event and fetches file changes]
    F --> C
    C --> G[Worker pipeline: OCR + LLM + validate + dedupe]
    G --> H{Duplicate?}
    H -- Yes --> I[Segregate to duplicate storage]
    H -- No --> J{Validation passed?}
    J -- No --> K[Route to error queue and storage]
    J -- Yes --> L[Rename file and persist outputs to S3/Azure Blob]
    L --> M[Reconciliation with Revenue book data]
    M --> N[Generate monthly/quarterly reports]
    N --> O[Dashboard view, download, and audit trail]
```

## Low Level Flow

```mermaid
flowchart TD
    A[Super Admin configures Drive folder and webhook channel] --> B[Store channel metadata and page token]
    B --> C[Initial backfill: capture startPageToken and scan folder]
    C --> D[files.list on target folder paged]
    D --> E[Enqueue each eligible file idempotent key]
    E --> F[Catch-up: changes.list from backfill startPageToken]
    F --> G[Persist latest page token for ongoing sync]

    G --> H[Webhook receives X-Goog notifications]
    H --> I[Validate channel ID and verification token]
    I --> J[Call changes.list with latest page token]
    J --> K[Filter changed files to target 2307 folder and file types]
    K --> L[Download file content and metadata from Drive]
    L --> M[Create idempotent queue message]

    M --> N[Worker loads file and computes hash]
    N --> O{Already processed revision/hash?}
    O -- Yes --> P[Skip and mark as duplicate or no-op]
    O -- No --> Q[OCR and layout extraction]

    Q --> R[Normalize fields with LLM]
    R --> S[Extract required data fields]
    S --> T[Run completeness validation]
    T --> U{All required fields present?}

    U -- No --> V[Tag errors and route to error storage]
    U -- Yes --> W[Lookup ATC rate and compute tax base work-back]
    W --> X{Variance <= PHP 100?}

    X -- No --> Y[Flag variance error and route to error storage]
    X -- Yes --> Z[Apply naming convention Co.Name_TIN_PeriodEnd_Sequence]
    Z --> AA[Persist processed PDF, JSON, and metadata to S3/Azure Blob + Postgres]

    AA --> AB[Load revenue prepaid CWT dataset]
    AB --> AC[Reconcile extracted vs book records]
    AC --> AD[Generate monthly/quarterly reconciliation outputs]
    AD --> AE[Publish status to dashboard and audit log]
```
