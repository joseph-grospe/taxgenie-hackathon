# Workflow Diagram

## High Level Flow

```mermaid
flowchart TD
    A[Revenue Team uploads 2307 to Google Drive folder] --> B[Google Drive webhook notification]
    B --> C[TaxTrack intake service validates event and fetches file changes]
    C --> D[Queue processing jobs]
    D --> E[AI extraction and normalization]
    E --> F{Duplicate?}
    F -- Yes --> G[Segregate to duplicate storage]
    F -- No --> H[Validation and ATC variance checks]
    H --> I{Validation passed?}
    I -- No --> J[Route to error queue and storage]
    I -- Yes --> K[Rename file and persist outputs to S3/Azure Blob]
    K --> L[Reconciliation with Revenue book data]
    L --> M[Generate monthly/quarterly reports]
    M --> N[Dashboard view, download, and audit trail]
```

## Low Level Flow

```mermaid
flowchart TD
    A[Admin configures Drive folder and webhook channel] --> B[Store channel metadata and page token]
    B --> C[Webhook receives X-Goog notifications]
    C --> D[Validate channel ID and verification token]
    D --> E[Call changes.list with latest page token]
    E --> F[Filter changed files to target 2307 folder and file types]
    F --> G[Download file content and metadata from Drive]
    G --> H[Create idempotent queue message]

    H --> I[Worker loads file and computes hash]
    I --> J{Already processed revision/hash?}
    J -- Yes --> K[Skip and mark as duplicate or no-op]
    J -- No --> L[OCR and layout extraction]

    L --> M[Normalize fields with LLM]
    M --> N[Extract required data fields]
    N --> O[Run completeness validation]
    O --> P{All required fields present?}

    P -- No --> Q[Tag errors and route to error storage]
    P -- Yes --> R[Lookup ATC rate and compute tax base work-back]
    R --> S{Variance <= PHP 100?}

    S -- No --> T[Flag variance error and route to error storage]
    S -- Yes --> U[Apply naming convention Co.Name_TIN_PeriodEnd_Sequence]
    U --> V[Persist processed PDF, JSON, and metadata to S3/Azure Blob + Postgres]

    V --> W[Load revenue prepaid CWT dataset]
    W --> X[Reconcile extracted vs book records]
    X --> Y[Generate monthly/quarterly reconciliation outputs]
    Y --> Z[Publish status to dashboard and audit log]
```
