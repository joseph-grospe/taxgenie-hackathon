# Workflow Diagram

## High Level Flow

```mermaid
flowchart TD
    A[Authorized user selects PDF files in TaxTrack] --> B[App creates intake batch]
    B --> C[Browser uploads each file directly to S3]
    C --> D[App validates uploaded object]
    D --> E[Enqueue one SQS message per file]
    E --> F["Worker calls Gemini 3 Flash Preview once with complete PDF"]
    F --> S{"Signature or trusted printed name missing?"}
    S -- Yes --> V["Local visual detector; optional PDF text-layer recovery"]
    S -- No --> N["Deterministic normalization"]
    V --> N
    N --> G{Duplicate or invalid?}
    G -- Yes --> H[Persist duplicate or failure result]
    G -- No --> I[Persist validated result and artifacts]
    I --> J[Reconciliation-ready data]
    H --> K[Batch and file status pages]
    J --> K
```

## Low Level Flow

```mermaid
flowchart TD
    A[POST /api/uploads/presign] --> B[Create intake_batches row]
    B --> C[Create intake_files rows]
    C --> D[Return presigned PUT URLs]
    D --> E[Browser PUT to storage bucket]
    E --> F[POST /api/uploads/complete]
    F --> G[HeadObject validation]
    G --> H[Send DocumentIngestEventV1 to SQS]
    H --> I[Worker loads source artifact]
    I --> J["Gemini structured whole-document extraction"]
    J --> V["Strict local signature fallback when required"]
    V --> K[Normalize fields]
    K --> L[Validate rules and dedupe]
    L --> M["Persist internal extraction attempt and one current document result"]
    M --> N[Refresh intake_files and intake_batches state]
```
